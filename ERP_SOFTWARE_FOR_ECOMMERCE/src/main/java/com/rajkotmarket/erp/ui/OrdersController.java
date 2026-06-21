package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.dao.OrderDao;
import com.rajkotmarket.erp.dao.VendorDao;
import com.rajkotmarket.erp.model.Order;
import com.rajkotmarket.erp.model.OrderEvent;
import com.rajkotmarket.erp.model.OrderItem;
import com.rajkotmarket.erp.model.Vendor;
import com.rajkotmarket.erp.util.Exporter;
import com.rajkotmarket.erp.util.Fmt;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.concurrent.Task;
import javafx.fxml.FXML;
import javafx.scene.control.*;
import javafx.scene.control.cell.PropertyValueFactory;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Orders module: searchable/filterable order list with a full detail dialog. */
public class OrdersController {

    private static final String ALL_STATUSES = "— All statuses —";

    @FXML private TextField searchField;
    @FXML private ComboBox<String> statusFilter;
    @FXML private ComboBox<Vendor> vendorFilter;
    @FXML private TableView<Order> table;
    @FXML private TableColumn<Order, String> colId;
    @FXML private TableColumn<Order, String> colDate;
    @FXML private TableColumn<Order, String> colCustomer;
    @FXML private TableColumn<Order, String> colShop;
    @FXML private TableColumn<Order, String> colStatus;
    @FXML private TableColumn<Order, String> colPayment;
    @FXML private TableColumn<Order, BigDecimal> colTotal;
    @FXML private Label countLabel;
    @FXML private Button viewButton;

    private final OrderDao orderDao = new OrderDao();
    private final VendorDao vendorDao = new VendorDao();
    private final ObservableList<Order> data = FXCollections.observableArrayList();
    private final ObservableList<Vendor> vendors = FXCollections.observableArrayList();

    @FXML
    private void initialize() {
        colId.setCellValueFactory(new PropertyValueFactory<>("orderId"));
        colDate.setCellValueFactory(new PropertyValueFactory<>("createdAtText"));
        colCustomer.setCellValueFactory(new PropertyValueFactory<>("customerName"));
        colShop.setCellValueFactory(new PropertyValueFactory<>("vendorName"));
        colStatus.setCellValueFactory(new PropertyValueFactory<>("status"));
        colPayment.setCellValueFactory(new PropertyValueFactory<>("paymentMethod"));
        colTotal.setCellValueFactory(new PropertyValueFactory<>("total"));

        colTotal.setCellFactory(c -> new TableCell<>() {
            @Override protected void updateItem(BigDecimal v, boolean empty) {
                super.updateItem(v, empty);
                setText(empty || v == null ? null : Fmt.money(v));
            }
        });
        colStatus.setCellFactory(c -> new TableCell<>() {
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
        });

        table.setItems(data);
        viewButton.disableProperty().bind(table.getSelectionModel().selectedItemProperty().isNull());
        table.setRowFactory(tv -> {
            TableRow<Order> row = new TableRow<>();
            row.setOnMouseClicked(e -> {
                if (e.getClickCount() == 2 && !row.isEmpty()) openDetail(row.getItem());
            });
            return row;
        });

        statusFilter.setItems(FXCollections.observableArrayList());
        statusFilter.getItems().add(ALL_STATUSES);
        statusFilter.getItems().addAll(OrderDao.STATUSES);
        statusFilter.getSelectionModel().selectFirst();
        statusFilter.valueProperty().addListener((o, a, b) -> reload());

        vendorFilter.setItems(vendors);
        vendorFilter.valueProperty().addListener((o, a, b) -> reload());

        searchField.setOnAction(e -> reload());

        loadVendors();
        reload();
    }

    private void loadVendors() {
        Task<List<Vendor>> t = new Task<>() {
            @Override protected List<Vendor> call() throws Exception { return vendorDao.listAll(); }
        };
        t.setOnSucceeded(e -> {
            vendors.setAll(t.getValue());
            vendors.add(0, new Vendor(null, "— All shops —", true));
            vendorFilter.getSelectionModel().selectFirst();
        });
        daemon(t);
    }

    @FXML
    private void reload() {
        String search = searchField.getText();
        String status = statusFilter.getValue();
        if (ALL_STATUSES.equals(status)) status = null;
        Vendor v = vendorFilter.getValue();
        String vendorId = (v == null) ? null : v.getId();

        final String fStatus = status;
        Task<List<Order>> t = new Task<>() {
            @Override protected List<Order> call() throws Exception {
                return orderDao.list(search, fStatus, vendorId);
            }
        };
        t.setOnSucceeded(e -> {
            data.setAll(t.getValue());
            countLabel.setText(data.size() + (data.size() == 1 ? " order" : " orders"));
        });
        t.setOnFailed(e -> error(t.getException()));
        daemon(t);
    }

    @FXML
    private void onView() {
        Order sel = table.getSelectionModel().getSelectedItem();
        if (sel != null) openDetail(sel);
    }

    @FXML
    private void onExport() {
        List<String> headers = List.of("Order #", "Placed", "Customer", "Phone", "Shop", "Status",
                "Payment", "Payment status", "Subtotal", "Delivery", "Discount", "Commission", "Total", "Returned");
        List<List<Object>> rows = new ArrayList<>();
        for (Order o : data) {
            rows.add(Arrays.asList(
                    o.getOrderId(), o.getCreatedAtText(), o.getCustomerName(), o.getCustomerPhone(),
                    o.getVendorName(), o.getStatus(), o.getPaymentMethod(), o.getPaymentStatus(),
                    o.getSubtotal(), o.getDeliveryFee(), o.getDiscount(), o.getCommissionAmount(),
                    o.getTotal(), o.isReturned() ? "Yes" : "No"));
        }
        Exporter.chooseAndExport(table, "orders", "Orders", headers, rows);
    }

    private void openDetail(Order o) {
        Task<Object[]> t = new Task<>() {
            @Override protected Object[] call() throws Exception {
                List<OrderItem> items = orderDao.items(o.getOrderId());
                List<OrderEvent> events = orderDao.events(o.getOrderId());
                return new Object[]{items, events};
            }
        };
        t.setOnSucceeded(e -> {
            @SuppressWarnings("unchecked")
            List<OrderItem> items = (List<OrderItem>) t.getValue()[0];
            @SuppressWarnings("unchecked")
            List<OrderEvent> events = (List<OrderEvent>) t.getValue()[1];
            OrderDetail.show(o, items, events, table);
        });
        t.setOnFailed(e -> error(t.getException()));
        daemon(t);
    }

    private void daemon(Task<?> t) { Thread th = new Thread(t); th.setDaemon(true); th.start(); }

    private void error(Throwable ex) {
        Alert a = new Alert(Alert.AlertType.ERROR, ex == null ? "Unknown error" : ex.getMessage(), ButtonType.OK);
        a.setHeaderText("Operation failed");
        a.showAndWait();
    }
}
