package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.model.Order;
import com.rajkotmarket.erp.model.OrderEvent;
import com.rajkotmarket.erp.model.OrderItem;
import com.rajkotmarket.erp.util.Fmt;
import javafx.collections.FXCollections;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.*;
import javafx.scene.layout.*;

import java.math.BigDecimal;
import java.util.List;

/** A read-only dialog showing one order's header, line items and status timeline. */
final class OrderDetail {

    private OrderDetail() { }

    static void show(Order o, List<OrderItem> items, List<OrderEvent> events, Node anchor) {
        Dialog<Void> dlg = new Dialog<>();
        dlg.setTitle("Order " + o.getOrderId());
        dlg.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dlg.getDialogPane().setPrefWidth(720);

        VBox content = new VBox(14);
        content.getStyleClass().add("dialog-body");
        content.setPadding(new Insets(6));
        content.getChildren().addAll(header(o), itemsTable(items), totalsBox(o), timeline(events));

        ScrollPane sp = new ScrollPane(content);
        sp.setFitToWidth(true);
        sp.setPrefHeight(560);
        sp.getStyleClass().add("edge-to-edge");
        dlg.getDialogPane().setContent(sp);
        dlg.setResizable(true);
        DialogStyle.apply(dlg, anchor);
        dlg.showAndWait();
    }

    private static Node header(Order o) {
        GridPane g = new GridPane();
        g.setHgap(28); g.setVgap(6);
        int r = 0;
        addRow(g, r++, "Order ID", o.getOrderId());
        addRow(g, r++, "Placed", Fmt.dateTime(o.getCreatedAt()));
        addRow(g, r++, "Status", o.getStatus() + (o.isReturned() ? "  (returned)" : ""));
        addRow(g, r++, "Customer", o.getCustomerName() + "  ·  " + nz(o.getCustomerPhone()));
        addRow(g, r++, "Shop", nz(o.getVendorName()));
        addRow(g, r++, "Payment", nz(o.getPaymentMethod()) + "  ·  " + nz(o.getPaymentStatus()));
        TitledPane tp = new TitledPane("Summary", g);
        tp.setCollapsible(false);
        return tp;
    }

    private static TableView<OrderItem> itemsTable(List<OrderItem> items) {
        TableView<OrderItem> tv = new TableView<>(FXCollections.observableArrayList(items));
        tv.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        tv.setPrefHeight(190);

        TableColumn<OrderItem, String> name = new TableColumn<>("Product");
        name.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(c.getValue().getProductName()));
        TableColumn<OrderItem, String> opts = new TableColumn<>("Options");
        opts.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(
                c.getValue().getSpecs() == null ? "—" : c.getValue().getSpecs()));
        TableColumn<OrderItem, Number> qty = new TableColumn<>("Qty");
        qty.setCellValueFactory(c -> new javafx.beans.property.SimpleIntegerProperty(c.getValue().getQty()));
        qty.setMaxWidth(70);
        TableColumn<OrderItem, String> unit = new TableColumn<>("Unit");
        unit.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(Fmt.money(c.getValue().getUnitPrice())));
        TableColumn<OrderItem, String> line = new TableColumn<>("Line total");
        line.setCellValueFactory(c -> new javafx.beans.property.SimpleStringProperty(Fmt.money(c.getValue().getLineTotal())));
        tv.getColumns().addAll(List.of(name, opts, qty, unit, line));

        if (items.isEmpty()) tv.setPlaceholder(new Label("No line items recorded (order may be archived)."));
        return tv;
    }

    private static Node totalsBox(Order o) {
        GridPane g = new GridPane();
        g.setHgap(12); g.setVgap(4);
        int r = 0;
        money(g, r++, "Subtotal", o.getSubtotal());
        money(g, r++, "Delivery fee", o.getDeliveryFee());
        if (o.getDiscount() != null && o.getDiscount().compareTo(BigDecimal.ZERO) > 0)
            money(g, r++, "Discount", o.getDiscount().negate());
        money(g, r++, "Commission (platform)", o.getCommissionAmount());
        Label tl = new Label("Total");  tl.getStyleClass().add("kpi-title");
        Label tv = new Label(Fmt.money(o.getTotal())); tv.getStyleClass().add("kpi-value");
        g.add(tl, 0, r); g.add(tv, 1, r);
        HBox box = new HBox(g);
        box.setAlignment(Pos.CENTER_RIGHT);
        return box;
    }

    private static Node timeline(List<OrderEvent> events) {
        VBox list = new VBox(6);
        if (events.isEmpty()) {
            list.getChildren().add(new Label("No status history recorded."));
        } else {
            for (OrderEvent e : events) {
                String flow = (e.getFromStatus() != null || e.getToStatus() != null)
                        ? "  " + nz(e.getFromStatus()) + " → " + nz(e.getToStatus()) : "";
                Label line = new Label("• " + Fmt.dateTime(e.getCreatedAt()) + "   "
                        + e.getEvent() + flow + "   [" + nz(e.getActor()) + "]"
                        + (e.getNote() != null ? "  — " + e.getNote() : ""));
                line.setWrapText(true);
                list.getChildren().add(line);
            }
        }
        TitledPane tp = new TitledPane("Status timeline (" + events.size() + ")", list);
        tp.setCollapsible(true);
        return tp;
    }

    private static void addRow(GridPane g, int r, String k, String v) {
        Label kl = new Label(k); kl.getStyleClass().add("kpi-title");
        g.add(kl, 0, r); g.add(new Label(nz(v)), 1, r);
    }
    private static void money(GridPane g, int r, String k, BigDecimal v) {
        g.add(new Label(k), 0, r);
        Label vl = new Label(Fmt.money(v)); GridPane.setHalignment(vl, javafx.geometry.HPos.RIGHT);
        g.add(vl, 1, r);
    }
    private static String nz(String s) { return s == null ? "—" : s; }
}
