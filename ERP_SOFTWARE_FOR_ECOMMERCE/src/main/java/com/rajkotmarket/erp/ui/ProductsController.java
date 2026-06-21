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
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;

import com.rajkotmarket.erp.util.Exporter;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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

        Task<List<ProductVariant>> t = new Task<>() {
            @Override protected List<ProductVariant> call() throws Exception {
                return productDao.variants(sel.getId());
            }
        };
        runAsync(t, vs -> showVariantsDialog(sel, vs));
    }

    private void showVariantsDialog(Product p, List<ProductVariant> variants) {
        TableView<ProductVariant> tv = new TableView<>(FXCollections.observableArrayList(variants));
        tv.setPrefSize(540, 380);
        tv.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);

        TableColumn<ProductVariant, String> combo = new TableColumn<>("Combination");
        combo.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(c.getValue().getCombination()));
        TableColumn<ProductVariant, Number> stk = new TableColumn<>("Stock");
        stk.setCellValueFactory(c -> new javafx.beans.property.SimpleIntegerProperty(c.getValue().getStock()));
        stk.setMaxWidth(120);
        stk.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(Number v, boolean empty) {
                super.updateItem(v, empty);
                if (empty || v == null) { setText(null); getStyleClass().remove("low-stock-cell"); return; }
                setText(String.valueOf(v.intValue()));
                if (v.intValue() <= 5) {
                    if (!getStyleClass().contains("low-stock-cell")) getStyleClass().add("low-stock-cell");
                } else getStyleClass().remove("low-stock-cell");
            }
        });
        tv.getColumns().addAll(List.of(combo, stk));

        int total = variants.stream().mapToInt(ProductVariant::getStock).sum();
        if (variants.isEmpty()) {
            tv.setPlaceholder(new Label("No size/colour variants — this product uses a single stock of " + p.getStock() + "."));
        }

        Dialog<Void> dlg = new Dialog<>();
        dlg.setTitle("Variants");
        dlg.setHeaderText("Size / colour stock for \"" + p.getName() + "\""
                + (variants.isEmpty() ? "" : "   (total " + total + " across " + variants.size() + " variants)"));
        dlg.getDialogPane().setContent(tv);
        dlg.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dlg.showAndWait();
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
