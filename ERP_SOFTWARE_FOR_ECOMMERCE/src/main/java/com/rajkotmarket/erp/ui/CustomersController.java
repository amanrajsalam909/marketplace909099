package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.dao.CustomerDao;
import com.rajkotmarket.erp.dao.OrderDao;
import com.rajkotmarket.erp.model.Customer;
import com.rajkotmarket.erp.model.Order;
import com.rajkotmarket.erp.util.Exporter;
import com.rajkotmarket.erp.util.Fmt;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.concurrent.Task;
import javafx.fxml.FXML;
import javafx.geometry.Insets;
import javafx.scene.control.*;
import javafx.scene.control.cell.PropertyValueFactory;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Customers (CRM) module: searchable/sortable list with per-customer order history. */
public class CustomersController {

    @FXML private TextField searchField;
    @FXML private ComboBox<String> sortCombo;
    @FXML private TableView<Customer> table;
    @FXML private TableColumn<Customer, String> colName;
    @FXML private TableColumn<Customer, String> colPhone;
    @FXML private TableColumn<Customer, String> colEmail;
    @FXML private TableColumn<Customer, Integer> colOrders;
    @FXML private TableColumn<Customer, BigDecimal> colSpent;
    @FXML private TableColumn<Customer, String> colLast;
    @FXML private Label countLabel;
    @FXML private Button viewButton;

    private final CustomerDao customerDao = new CustomerDao();
    private final OrderDao orderDao = new OrderDao();
    private final ObservableList<Customer> data = FXCollections.observableArrayList();

    // label → sort key passed to the DAO
    private static final List<String> SORTS = List.of(
            "Top spenders", "Most orders", "Most recent", "Name (A–Z)");

    @FXML
    private void initialize() {
        colName.setCellValueFactory(new PropertyValueFactory<>("name"));
        colPhone.setCellValueFactory(new PropertyValueFactory<>("phone"));
        colEmail.setCellValueFactory(new PropertyValueFactory<>("email"));
        colOrders.setCellValueFactory(new PropertyValueFactory<>("totalOrders"));
        colSpent.setCellValueFactory(new PropertyValueFactory<>("totalSpent"));
        colLast.setCellValueFactory(new PropertyValueFactory<>("lastOrderText"));

        colSpent.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(BigDecimal v, boolean empty) {
                super.updateItem(v, empty);
                setText(empty || v == null ? null : Fmt.money(v));
            }
        });

        table.setItems(data);
        viewButton.disableProperty().bind(table.getSelectionModel().selectedItemProperty().isNull());
        table.setRowFactory(tv -> {
            TableRow<Customer> row = new TableRow<>();
            row.setOnMouseClicked(e -> {
                if (e.getClickCount() == 2 && !row.isEmpty()) openOrders(row.getItem());
            });
            return row;
        });

        sortCombo.setItems(FXCollections.observableArrayList(SORTS));
        sortCombo.getSelectionModel().selectFirst();
        sortCombo.valueProperty().addListener((o, a, b) -> reload());
        searchField.setOnAction(e -> reload());

        reload();
    }

    private String sortKey() {
        String s = sortCombo.getValue();
        if (s == null) return "spent";
        return switch (s) {
            case "Most orders" -> "orders";
            case "Most recent" -> "recent";
            case "Name (A–Z)"  -> "name";
            default             -> "spent";
        };
    }

    @FXML
    private void reload() {
        String search = searchField.getText();
        String sort = sortKey();
        Task<List<Customer>> t = new Task<>() {
            @Override protected List<Customer> call() throws Exception { return customerDao.list(search, sort); }
        };
        t.setOnSucceeded(e -> {
            data.setAll(t.getValue());
            countLabel.setText(data.size() + (data.size() == 1 ? " customer" : " customers"));
        });
        t.setOnFailed(e -> error(t.getException()));
        daemon(t);
    }

    @FXML
    private void onView() {
        Customer sel = table.getSelectionModel().getSelectedItem();
        if (sel != null) openOrders(sel);
    }

    @FXML
    private void onExport() {
        List<String> headers = List.of("Name", "Phone", "Email", "Orders", "Lifetime spend", "Last order");
        List<List<Object>> rows = new ArrayList<>();
        for (Customer c : data) {
            rows.add(Arrays.asList(
                    c.getName(), c.getPhone(), c.getEmail(),
                    c.getTotalOrders(), c.getTotalSpent(), c.getLastOrderText()));
        }
        Exporter.chooseAndExport(table, "customers", "Customers", headers, rows);
    }

    /** Show a dialog listing this customer's orders; double-click opens full order detail. */
    private void openOrders(Customer cust) {
        Task<List<Order>> t = new Task<>() {
            @Override protected List<Order> call() throws Exception {
                return orderDao.listByCustomer(cust.getId());
            }
        };
        t.setOnSucceeded(e -> showOrdersDialog(cust, t.getValue()));
        t.setOnFailed(e -> error(t.getException()));
        daemon(t);
    }

    private void showOrdersDialog(Customer cust, List<Order> orders) {
        TableView<Order> tv = new TableView<>(FXCollections.observableArrayList(orders));
        tv.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        tv.setPrefHeight(360);
        VBox.setVgrow(tv, javafx.scene.layout.Priority.ALWAYS);

        TableColumn<Order, String> id = new TableColumn<>("Order #");
        id.setCellValueFactory(new PropertyValueFactory<>("orderId"));
        TableColumn<Order, String> date = new TableColumn<>("Date");
        date.setCellValueFactory(new PropertyValueFactory<>("createdAtText"));
        TableColumn<Order, String> shop = new TableColumn<>("Shop");
        shop.setCellValueFactory(new PropertyValueFactory<>("vendorName"));
        TableColumn<Order, String> status = new TableColumn<>("Status");
        status.setCellValueFactory(new PropertyValueFactory<>("status"));
        status.setCellFactory(c -> statusCell());
        TableColumn<Order, BigDecimal> total = new TableColumn<>("Total");
        total.setCellValueFactory(new PropertyValueFactory<>("total"));
        total.setCellFactory(c -> moneyCell());
        tv.getColumns().addAll(List.of(id, date, shop, status, total));
        tv.setPlaceholder(new Label("No orders found for this customer."));
        tv.setRowFactory(t -> {
            TableRow<Order> row = new TableRow<>();
            row.setOnMouseClicked(e -> {
                if (e.getClickCount() == 2 && !row.isEmpty()) openOrderDetail(row.getItem());
            });
            return row;
        });

        // Header: name + contact + stat chips
        Label name = new Label(cust.getName() == null ? "Customer" : cust.getName());
        name.getStyleClass().add("dialog-title");
        Label contact = new Label(nz(cust.getPhone()) + "   ·   " + nz(cust.getEmail()));
        contact.getStyleClass().add("hint");
        HBox chips = new HBox(12,
                chip(String.valueOf(cust.getTotalOrders()), "Orders"),
                chip(Fmt.money(cust.getTotalSpent()), "Lifetime spend"),
                chip(Fmt.date(cust.getLastOrderDate()), "Last order"));
        VBox header = new VBox(6, name, contact, chips);
        header.getStyleClass().add("dialog-header");

        Label hint = new Label("Double-click an order to see its full details.");
        hint.getStyleClass().add("hint");

        VBox content = new VBox(14, header, tv, hint);
        content.getStyleClass().add("dialog-body");
        content.setPadding(new Insets(4));

        Dialog<Void> dlg = new Dialog<>();
        dlg.setTitle("Customer · " + cust.getName());
        dlg.getDialogPane().setContent(content);
        dlg.getDialogPane().setPrefSize(720, 540);
        dlg.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dlg.setResizable(true);
        DialogStyle.apply(dlg, table);
        dlg.showAndWait();
    }

    private VBox chip(String value, String label) {
        Label v = new Label(value); v.getStyleClass().add("chip-value");
        Label l = new Label(label.toUpperCase()); l.getStyleClass().add("chip-label");
        VBox box = new VBox(2, v, l);
        box.getStyleClass().add("stat-chip");
        HBox.setHgrow(box, javafx.scene.layout.Priority.ALWAYS);
        return box;
    }

    private TableCell<Order, BigDecimal> moneyCell() {
        return new TableCell<>() {
            @Override protected void updateItem(BigDecimal v, boolean empty) {
                super.updateItem(v, empty);
                setText(empty || v == null ? null : Fmt.money(v));
            }
        };
    }

    private TableCell<Order, String> statusCell() {
        return new TableCell<>() {
            @Override protected void updateItem(String v, boolean empty) {
                super.updateItem(v, empty);
                getStyleClass().removeAll("st-delivered", "st-cancelled", "st-progress");
                if (empty || v == null) { setText(null); return; }
                setText(v);
                switch (v) {
                    case "delivered" -> getStyleClass().add("st-delivered");
                    case "cancelled" -> getStyleClass().add("st-cancelled");
                    default -> getStyleClass().add("st-progress");
                }
            }
        };
    }

    private void openOrderDetail(Order o) {
        Task<Object[]> t = new Task<>() {
            @Override protected Object[] call() throws Exception {
                return new Object[]{orderDao.items(o.getOrderId()), orderDao.events(o.getOrderId())};
            }
        };
        t.setOnSucceeded(e -> {
            @SuppressWarnings("unchecked") var items = (List<com.rajkotmarket.erp.model.OrderItem>) t.getValue()[0];
            @SuppressWarnings("unchecked") var events = (List<com.rajkotmarket.erp.model.OrderEvent>) t.getValue()[1];
            OrderDetail.show(o, items, events, table);
        });
        t.setOnFailed(e -> error(t.getException()));
        daemon(t);
    }

    private void daemon(Task<?> t) { Thread th = new Thread(t); th.setDaemon(true); th.start(); }

    private static String nz(String s) { return s == null ? "—" : s; }

    private void error(Throwable ex) {
        Alert a = new Alert(Alert.AlertType.ERROR, ex == null ? "Unknown error" : ex.getMessage(), ButtonType.OK);
        a.setHeaderText("Operation failed");
        a.showAndWait();
    }
}
