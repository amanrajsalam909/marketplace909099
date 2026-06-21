package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.dao.InventoryDao;
import com.rajkotmarket.erp.dao.ProductDao;
import com.rajkotmarket.erp.dao.VendorDao;
import com.rajkotmarket.erp.model.InventoryMovement;
import com.rajkotmarket.erp.model.Product;
import com.rajkotmarket.erp.model.ProductVariant;
import com.rajkotmarket.erp.model.Vendor;
import javafx.application.Platform;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.concurrent.Task;
import javafx.fxml.FXML;
import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.control.cell.PropertyValueFactory;
import javafx.scene.control.cell.TextFieldTableCell;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

import com.rajkotmarket.erp.util.Exporter;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Products & Inventory module: browse/search the catalog, create/edit/delete
 * products, and make audited stock adjustments. Also serves the "Low stock"
 * view when {@link #setLowStockMode(boolean)} is enabled.
 */
public class ProductsController {

    @FXML private TextField searchField;
    @FXML private ComboBox<Vendor> vendorFilter;
    @FXML private TableView<Product> table;
    @FXML private TableColumn<Product, String> colNo;
    @FXML private TableColumn<Product, String> colName;
    @FXML private TableColumn<Product, String> colCategory;
    @FXML private TableColumn<Product, String> colVendor;
    @FXML private TableColumn<Product, BigDecimal> colPrice;
    @FXML private TableColumn<Product, Integer> colStock;
    @FXML private TableColumn<Product, Boolean> colActive;
    @FXML private Label countLabel;
    @FXML private Label titleLabel;
    @FXML private HBox lowStockControls;
    @FXML private Spinner<Integer> thresholdSpinner;
    @FXML private Button editButton;
    @FXML private Button deleteButton;
    @FXML private Button adjustButton;
    @FXML private Button historyButton;
    @FXML private Button variantsButton;

    private final ProductDao productDao = new ProductDao();
    private final VendorDao vendorDao = new VendorDao();
    private final InventoryDao inventoryDao = new InventoryDao();

    private final ObservableList<Product> data = FXCollections.observableArrayList();
    private final ObservableList<Vendor> vendors = FXCollections.observableArrayList();
    private boolean lowStockMode = false;

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm");

    @FXML
    private void initialize() {
        colNo.setCellValueFactory(new PropertyValueFactory<>("productNo"));
        colName.setCellValueFactory(new PropertyValueFactory<>("name"));
        colCategory.setCellValueFactory(new PropertyValueFactory<>("category"));
        colVendor.setCellValueFactory(new PropertyValueFactory<>("vendorName"));
        colPrice.setCellValueFactory(new PropertyValueFactory<>("price"));
        colStock.setCellValueFactory(new PropertyValueFactory<>("stock"));
        colActive.setCellValueFactory(new PropertyValueFactory<>("active"));

        colPrice.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(BigDecimal v, boolean empty) {
                super.updateItem(v, empty);
                setText(empty || v == null ? null : "₹" + v.toPlainString());
            }
        });
        colActive.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(Boolean v, boolean empty) {
                super.updateItem(v, empty);
                setText(empty || v == null ? null : (v ? "Active" : "Hidden"));
            }
        });
        // Highlight low-stock rows in red.
        colStock.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(Integer v, boolean empty) {
                super.updateItem(v, empty);
                if (empty || v == null) { setText(null); getStyleClass().remove("low-stock-cell"); return; }
                setText(String.valueOf(v));
                if (v <= lowThreshold()) {
                    if (!getStyleClass().contains("low-stock-cell")) getStyleClass().add("low-stock-cell");
                } else {
                    getStyleClass().remove("low-stock-cell");
                }
            }
        });

        table.setItems(data);
        table.getSelectionModel().setSelectionMode(SelectionMode.SINGLE);

        // Buttons that act on a selection are disabled until a row is chosen.
        var noSel = table.getSelectionModel().selectedItemProperty().isNull();
        editButton.disableProperty().bind(noSel);
        deleteButton.disableProperty().bind(noSel);
        adjustButton.disableProperty().bind(noSel);
        historyButton.disableProperty().bind(noSel);
        variantsButton.disableProperty().bind(noSel);

        thresholdSpinner.setValueFactory(new SpinnerValueFactory.IntegerSpinnerValueFactory(0, 100000, 10));
        thresholdSpinner.valueProperty().addListener((o, a, b) -> reload());

        searchField.setOnAction(e -> reload());

        vendorFilter.setItems(vendors);
        vendorFilter.valueProperty().addListener((o, a, b) -> reload());

        loadVendors();
        applyMode();
        reload();
    }

    /** Toggle between the full catalog and the low-stock-only view. */
    public void setLowStockMode(boolean on) {
        this.lowStockMode = on;
        if (table != null) { applyMode(); reload(); }
    }

    private void applyMode() {
        titleLabel.setText(lowStockMode ? "Low Stock" : "Products & Inventory");
        lowStockControls.setVisible(lowStockMode);
        lowStockControls.setManaged(lowStockMode);
    }

    private int lowThreshold() {
        return thresholdSpinner.getValue() == null ? 10 : thresholdSpinner.getValue();
    }

    // -- data loading -------------------------------------------------------

    private void loadVendors() {
        Task<List<Vendor>> t = new Task<>() {
            @Override protected List<Vendor> call() throws Exception { return vendorDao.listAll(); }
        };
        runAsync(t, list -> {
            vendors.setAll(list);
            vendors.add(0, new Vendor(null, "— All shops —", true));
            vendorFilter.getSelectionModel().selectFirst();
        });
    }

    @FXML
    private void reload() {
        String search = searchField.getText();
        Vendor v = vendorFilter.getValue();
        String vendorId = (v == null) ? null : v.getId();
        int threshold = lowStockMode ? lowThreshold() : -1;

        Task<List<Product>> t = new Task<>() {
            @Override protected List<Product> call() throws Exception {
                return productDao.list(search, vendorId, threshold);
            }
        };
        runAsync(t, list -> {
            data.setAll(list);
            countLabel.setText(list.size() + (list.size() == 1 ? " product" : " products"));
        });
    }

    // -- product CRUD -------------------------------------------------------

    @FXML
    private void onAdd() {
        Optional<Product> result = showProductDialog(null);
        result.ifPresent(p -> runVoid(() -> productDao.insert(p),
                "Product \"" + p.getName() + "\" created (code " + p.getProductNo() + ")."));
    }

    @FXML
    private void onEdit() {
        Product sel = table.getSelectionModel().getSelectedItem();
        if (sel == null) return;
        Optional<Product> result = showProductDialog(sel);
        result.ifPresent(p -> runVoid(() -> productDao.update(p),
                "Product \"" + p.getName() + "\" updated."));
    }

    @FXML
    private void onDelete() {
        Product sel = table.getSelectionModel().getSelectedItem();
        if (sel == null) return;
        Alert confirm = new Alert(Alert.AlertType.CONFIRMATION,
                "Permanently delete \"" + sel.getName() + "\"?\n\n" +
                "Tip: to merely hide it from the storefront, edit it and untick \"Active\" instead.",
                ButtonType.OK, ButtonType.CANCEL);
        confirm.setHeaderText("Delete product");
        confirm.showAndWait().filter(b -> b == ButtonType.OK).ifPresent(b ->
                runVoid(() -> productDao.delete(sel.getId()), "Product deleted."));
    }

    // -- stock --------------------------------------------------------------

    @FXML
    private void onAdjustStock() {
        Product sel = table.getSelectionModel().getSelectedItem();
        if (sel == null) return;

        // Variant products keep their stock per size/colour — adjusting the single
        // total here would break the sum. Route the user to the variants editor.
        if (sel.getVariantCount() > 0) {
            info("Per-variant stock",
                    "\"" + sel.getName() + "\" tracks stock per size/colour combination.\n" +
                    "Use the \"Variants\" button to adjust each combination's stock.");
            onVariants();
            return;
        }

        Dialog<Integer> dlg = new Dialog<>();
        dlg.setTitle("Adjust Stock");
        dlg.setHeaderText("Adjust stock for \"" + sel.getName() + "\"\nCurrent stock: " + sel.getStock());

        ButtonType apply = new ButtonType("Apply", ButtonBar.ButtonData.OK_DONE);
        dlg.getDialogPane().getButtonTypes().addAll(apply, ButtonType.CANCEL);

        ToggleGroup mode = new ToggleGroup();
        RadioButton addMode = new RadioButton("Add / remove (use a minus sign to remove)");
        RadioButton setMode = new RadioButton("Set stock to an exact value");
        addMode.setToggleGroup(mode); setMode.setToggleGroup(mode); addMode.setSelected(true);

        Spinner<Integer> amount = new Spinner<>(-1000000, 1000000, 0);
        amount.setEditable(true);
        TextField reason = new TextField();
        reason.setPromptText("Reason (e.g. restock, stock count, damage)");

        VBox box = new VBox(10, addMode, setMode, new Label("Amount:"), amount,
                new Label("Reason:"), reason);
        box.setPadding(new Insets(12));
        dlg.getDialogPane().setContent(box);

        dlg.setResultConverter(bt -> {
            if (bt != apply) return null;
            int val = amount.getValue() == null ? 0 : amount.getValue();
            return setMode.isSelected() ? (val - sel.getStock()) : val;  // convert to a delta
        });

        Optional<Integer> deltaOpt = dlg.showAndWait();
        if (deltaOpt.isEmpty()) return;
        int delta = deltaOpt.get();
        if (delta == 0) { info("No change", "Stock is unchanged."); return; }

        String why = reason.getText() == null || reason.getText().isBlank() ? "manual" : reason.getText().trim();
        runVoid(() -> inventoryDao.applyChange(sel.getId(), delta, why),
                "Stock for \"" + sel.getName() + "\" changed by " + delta + ".");
    }

    @FXML
    private void onExport() {
        List<String> headers = List.of("Code", "Product", "Category", "Shop", "Price", "Stock", "Status");
        List<List<Object>> rows = new ArrayList<>();
        for (Product p : data) {
            rows.add(Arrays.asList(
                    p.getProductNo(), p.getName(), p.getCategory(), p.getVendorName(),
                    p.getPrice(), p.getStock(), p.isActive() ? "Active" : "Hidden"));
        }
        Exporter.chooseAndExport(table, lowStockMode ? "low-stock" : "products",
                lowStockMode ? "Low stock" : "Products", headers, rows);
    }

    @FXML
    private void onHistory() {
        Product sel = table.getSelectionModel().getSelectedItem();
        if (sel == null) return;

        Task<List<InventoryMovement>> t = new Task<>() {
            @Override protected List<InventoryMovement> call() throws Exception {
                return inventoryDao.history(sel.getId(), 200);
            }
        };
        runAsync(t, moves -> showHistoryDialog(sel, moves));
    }

    private void showHistoryDialog(Product p, List<InventoryMovement> moves) {
        TableView<InventoryMovement> tv = new TableView<>(FXCollections.observableArrayList(moves));
        tv.setPrefSize(640, 420);

        TableColumn<InventoryMovement, String> when = new TableColumn<>("When");
        when.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(
                c.getValue().getCreatedAt() == null ? "" : TS.format(c.getValue().getCreatedAt())));
        when.setPrefWidth(150);
        TableColumn<InventoryMovement, Number> chg = new TableColumn<>("Change");
        chg.setCellValueFactory(c -> new javafx.beans.property.SimpleIntegerProperty(c.getValue().getChange()));
        TableColumn<InventoryMovement, Number> after = new TableColumn<>("After");
        after.setCellValueFactory(c -> new javafx.beans.property.SimpleIntegerProperty(c.getValue().getStockAfter()));
        TableColumn<InventoryMovement, String> reason = new TableColumn<>("Reason");
        reason.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(c.getValue().getReason()));
        reason.setPrefWidth(160);
        TableColumn<InventoryMovement, String> ord = new TableColumn<>("Order");
        ord.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(c.getValue().getOrderId()));
        ord.setPrefWidth(150);
        tv.getColumns().addAll(List.of(when, chg, after, reason, ord));

        Dialog<Void> dlg = new Dialog<>();
        dlg.setTitle("Stock history");
        dlg.setHeaderText("Stock movements for \"" + p.getName() + "\"");
        dlg.getDialogPane().setContent(tv);
        dlg.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dlg.showAndWait();
    }

    // -- variants (per size/colour stock) -----------------------------------

    @FXML
    private void onVariants() {
        Product sel = table.getSelectionModel().getSelectedItem();
        if (sel == null) return;

        Task<Object[]> t = new Task<>() {
            @Override protected Object[] call() throws Exception {
                return new Object[]{ productDao.variants(sel.getId()), productDao.templateOptions(sel.getId()) };
            }
        };
        runAsync(t, arr -> {
            @SuppressWarnings("unchecked") List<ProductVariant> vs = (List<ProductVariant>) arr[0];
            @SuppressWarnings("unchecked") LinkedHashMap<String, List<String>> opts =
                    (LinkedHashMap<String, List<String>>) arr[1];
            showVariantsDialog(sel, vs, opts);
        });
    }

    private void showVariantsDialog(Product p, List<ProductVariant> variants,
                                    LinkedHashMap<String, List<String>> options) {
        ObservableList<ProductVariant> rows = FXCollections.observableArrayList(variants);

        TableView<ProductVariant> tv = new TableView<>(rows);
        tv.setPrefSize(560, 380);
        tv.setEditable(true);
        tv.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        tv.setPlaceholder(new Label("No combinations yet — use \"+ Add combination\"."));

        TableColumn<ProductVariant, String> combo = new TableColumn<>("Combination");
        combo.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(c.getValue().getCombination()));
        combo.setEditable(false);

        TableColumn<ProductVariant, String> stk = new TableColumn<>("Stock");
        stk.setMaxWidth(140);
        stk.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(String.valueOf(c.getValue().getStock())));
        stk.setCellFactory(TextFieldTableCell.forTableColumn());
        tv.getColumns().addAll(List.of(combo, stk));

        Label totalLabel = new Label();
        Runnable refreshTotal = () -> totalLabel.setText(
                "Total: " + rows.stream().mapToInt(ProductVariant::getStock).sum()
                + "  (" + rows.size() + (rows.size() == 1 ? " variant)" : " variants)"));
        refreshTotal.run();

        stk.setOnEditCommit(ev -> {
            int v;
            try { v = Math.max(0, Integer.parseInt(ev.getNewValue().trim())); }
            catch (NumberFormatException e) { v = ev.getRowValue().getStock(); }
            ev.getRowValue().setStock(v);
            tv.refresh();
            refreshTotal.run();
        });

        Button addBtn = new Button("+ Add combination");
        addBtn.setDisable(options.isEmpty());
        addBtn.setOnAction(e -> {
            ProductVariant nv = promptAddCombination(options);
            if (nv == null) return;
            boolean dup = rows.stream().anyMatch(r -> r.getCombination().equalsIgnoreCase(nv.getCombination()));
            if (dup) { error("Duplicate", "That combination already exists."); return; }
            rows.add(nv);
            refreshTotal.run();
        });

        Button delBtn = new Button("Delete selected");
        delBtn.disableProperty().bind(tv.getSelectionModel().selectedItemProperty().isNull());
        delBtn.setOnAction(e -> {
            ProductVariant sel = tv.getSelectionModel().getSelectedItem();
            if (sel != null) { rows.remove(sel); refreshTotal.run(); }
        });

        Button exportBtn = new Button("⤓ Export");
        exportBtn.setOnAction(e -> {
            List<String> headers = List.of("Product", "Combination", "Stock");
            List<List<Object>> exportRows = new ArrayList<>();
            for (ProductVariant v : rows) exportRows.add(Arrays.asList(p.getName(), v.getCombination(), v.getStock()));
            Exporter.chooseAndExport(tv, "variants-" + (p.getProductNo() == null ? "product" : p.getProductNo()),
                    "Variants", headers, exportRows);
        });

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        HBox actions = new HBox(8, addBtn, delBtn, exportBtn, spacer, totalLabel);
        actions.setAlignment(javafx.geometry.Pos.CENTER_LEFT);

        VBox content = new VBox(10, actions, tv,
                new Label("Tip: double-click a Stock cell to edit. Changes save when you click \"Save changes\"."));
        content.setPadding(new Insets(4));

        Dialog<Boolean> dlg = new Dialog<>();
        dlg.setTitle("Variants");
        dlg.setHeaderText("Size / colour stock for \"" + p.getName() + "\"");
        ButtonType saveBt = new ButtonType("Save changes", ButtonBar.ButtonData.OK_DONE);
        dlg.getDialogPane().getButtonTypes().addAll(saveBt, ButtonType.CLOSE);
        dlg.getDialogPane().setContent(content);
        dlg.setResizable(true);
        dlg.setResultConverter(bt -> bt == saveBt);

        Optional<Boolean> res = dlg.showAndWait();
        if (res.isPresent() && res.get()) {
            List<ProductVariant> toSave = new ArrayList<>(rows);
            runVoid(() -> productDao.saveVariants(p.getId(), toSave),
                    "Saved " + toSave.size() + " variant(s) for \"" + p.getName() + "\".");
        }
    }

    /** Small dialog to pick one option per field and build a new combination. */
    private ProductVariant promptAddCombination(LinkedHashMap<String, List<String>> options) {
        Dialog<ProductVariant> d = new Dialog<>();
        d.setTitle("Add combination");
        ButtonType ok = new ButtonType("Add", ButtonBar.ButtonData.OK_DONE);
        d.getDialogPane().getButtonTypes().addAll(ok, ButtonType.CANCEL);

        GridPane g = new GridPane();
        g.setHgap(10); g.setVgap(10); g.setPadding(new Insets(14));
        Map<String, ComboBox<String>> pickers = new LinkedHashMap<>();
        int r = 0;
        for (Map.Entry<String, List<String>> e : options.entrySet()) {
            ComboBox<String> cb = new ComboBox<>(FXCollections.observableArrayList(e.getValue()));
            cb.getSelectionModel().selectFirst();
            pickers.put(e.getKey(), cb);
            g.addRow(r++, new Label(e.getKey()), cb);
        }
        d.getDialogPane().setContent(g);

        d.setResultConverter(bt -> {
            if (bt != ok) return null;
            LinkedHashMap<String, String> specs = new LinkedHashMap<>();
            for (Map.Entry<String, ComboBox<String>> e : pickers.entrySet()) {
                String val = e.getValue().getValue();
                if (val == null || val.isBlank()) return null;   // require every field
                specs.put(e.getKey(), val);
            }
            return new ProductVariant(null, formatCombination(specs), specsToJson(specs), 0);
        });
        return d.showAndWait().orElse(null);
    }

    // Combination label sorted by key, to match the DB's formatting (string_agg ORDER BY key).
    private static String formatCombination(Map<String, String> specs) {
        return specs.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + ": " + e.getValue())
                .reduce((a, b) -> a + " · " + b).orElse("");
    }

    private static String specsToJson(Map<String, String> specs) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : specs.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(jsonStr(e.getKey())).append(':').append(jsonStr(e.getValue()));
        }
        return sb.append('}').toString();
    }

    private static String jsonStr(String s) {
        return '"' + s.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }

    // -- product add/edit form ---------------------------------------------

    private Optional<Product> showProductDialog(Product existing) {
        boolean editing = existing != null;
        Dialog<Product> dlg = new Dialog<>();
        dlg.setTitle(editing ? "Edit Product" : "New Product");
        dlg.setHeaderText(editing ? "Edit \"" + existing.getName() + "\"" : "Create a new product");

        ButtonType save = new ButtonType(editing ? "Save" : "Create", ButtonBar.ButtonData.OK_DONE);
        dlg.getDialogPane().getButtonTypes().addAll(save, ButtonType.CANCEL);

        TextField name = new TextField();
        TextField category = new TextField();
        TextArea description = new TextArea(); description.setPrefRowCount(3);
        TextField price = new TextField();
        Spinner<Integer> stock = new Spinner<>(0, 1000000, 0);
        stock.setEditable(true);
        ComboBox<Vendor> vendor = new ComboBox<>(vendors);
        CheckBox active = new CheckBox("Active (visible on storefront)");
        active.setSelected(true);

        if (editing) {
            name.setText(existing.getName());
            category.setText(existing.getCategory());
            description.setText(existing.getDescription());
            price.setText(existing.getPrice() == null ? "0" : existing.getPrice().toPlainString());
            stock.getValueFactory().setValue(existing.getStock());
            stock.setDisable(true);   // stock is changed only via audited adjustments
            active.setSelected(existing.isActive());
            selectVendor(vendor, existing.getVendorId());
        } else {
            vendorFilterDefault(vendor);
        }

        GridPane g = new GridPane();
        g.setHgap(10); g.setVgap(10); g.setPadding(new Insets(14));
        int r = 0;
        g.addRow(r++, new Label("Name *"), name);
        g.addRow(r++, new Label("Shop"), vendor);
        g.addRow(r++, new Label("Category"), category);
        g.addRow(r++, new Label("Price (₹) *"), price);
        Label stockLabel = new Label("Stock");
        g.addRow(r++, stockLabel, stock);
        if (editing) {
            g.add(new Label("(adjust via \"Adjust Stock\")"), 2, r - 1);
        }
        g.addRow(r++, new Label("Description"), description);
        g.add(active, 1, r);
        GridPane.setHgrow(name, Priority.ALWAYS);

        dlg.getDialogPane().setContent(g);
        Platform.runLater(name::requestFocus);

        // Validate before allowing save.
        Button saveBtn = (Button) dlg.getDialogPane().lookupButton(save);
        saveBtn.addEventFilter(javafx.event.ActionEvent.ACTION, ev -> {
            if (name.getText() == null || name.getText().isBlank()) {
                error("Validation", "Name is required."); ev.consume(); return;
            }
            if (parsePrice(price.getText()) == null) {
                error("Validation", "Price must be a number like 199 or 49.50."); ev.consume();
            }
        });

        dlg.setResultConverter(bt -> {
            if (bt != save) return null;
            Product p = editing ? existing : new Product();
            p.setName(name.getText().trim());
            p.setCategory(blankToNull(category.getText()));
            p.setDescription(blankToNull(description.getText()));
            p.setPrice(parsePrice(price.getText()));
            p.setActive(active.isSelected());
            Vendor selV = vendor.getValue();
            p.setVendorId(selV == null ? null : selV.getId());
            if (!editing) p.setStock(stock.getValue());
            return p;
        });

        return dlg.showAndWait();
    }

    private void selectVendor(ComboBox<Vendor> combo, String vendorId) {
        if (vendorId == null) { combo.getSelectionModel().selectFirst(); return; }
        for (Vendor v : combo.getItems()) {
            if (vendorId.equals(v.getId())) { combo.getSelectionModel().select(v); return; }
        }
        combo.getSelectionModel().selectFirst();
    }

    private void vendorFilterDefault(ComboBox<Vendor> combo) {
        Vendor current = vendorFilter.getValue();
        if (current != null && current.getId() != null) selectVendor(combo, current.getId());
        else combo.getSelectionModel().selectFirst();
    }

    // -- helpers ------------------------------------------------------------

    /** Runs a DB write off the UI thread, then reloads and reports the outcome. */
    private void runVoid(SqlAction action, String successMsg) {
        Task<Void> t = new Task<>() {
            @Override protected Void call() throws Exception { action.run(); return null; }
        };
        t.setOnSucceeded(e -> { reload(); info("Done", successMsg); });
        t.setOnFailed(e -> error("Operation failed",
                t.getException() == null ? "Unknown error" : t.getException().getMessage()));
        daemon(t);
    }

    private <T> void runAsync(Task<T> t, java.util.function.Consumer<T> onOk) {
        t.setOnSucceeded(e -> onOk.accept(t.getValue()));
        t.setOnFailed(e -> error("Load failed",
                t.getException() == null ? "Unknown error" : t.getException().getMessage()));
        daemon(t);
    }

    private void daemon(Task<?> t) {
        Thread th = new Thread(t);
        th.setDaemon(true);
        th.start();
    }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    private static BigDecimal parsePrice(String s) {
        if (s == null || s.isBlank()) return null;
        try { return new BigDecimal(s.trim()); } catch (NumberFormatException e) { return null; }
    }

    private void info(String header, String msg) {
        Alert a = new Alert(Alert.AlertType.INFORMATION, msg, ButtonType.OK);
        a.setHeaderText(header); a.showAndWait();
    }

    private void error(String header, String msg) {
        Alert a = new Alert(Alert.AlertType.ERROR, msg, ButtonType.OK);
        a.setHeaderText(header); a.showAndWait();
    }

    @FunctionalInterface
    private interface SqlAction { void run() throws Exception; }
}
