package com.rajkotmarket.erp.dao;

import com.rajkotmarket.erp.db.Database;
import com.rajkotmarket.erp.model.Order;
import com.rajkotmarket.erp.model.OrderEvent;
import com.rajkotmarket.erp.model.OrderItem;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/** Read access to {@code orders}, {@code order_items} and {@code order_events}. */
public class OrderDao {

    /** Lifecycle statuses used by the website, in workflow order. */
    public static final List<String> STATUSES = List.of(
            "pending", "confirmed", "preparing", "ready", "delivered", "cancelled");

    private static final String SELECT_BASE =
            "SELECT o.order_id, o.customer_id, o.customer_name, o.customer_phone, " +
            "       v.name AS vendor_name, o.status, o.payment_method, o.payment_status, " +
            "       o.subtotal, o.delivery_fee, o.discount_amount, o.commission_amount, " +
            "       o.total, o.returned, o.created_at " +
            "FROM orders o LEFT JOIN vendors v ON v.id = o.vendor_id ";

    /**
     * List orders with optional filters.
     * @param search   matches order_id / customer name / phone (null = any)
     * @param status   exact status (null = any)
     * @param vendorId restrict to one shop (null = any)
     */
    public List<Order> list(String search, String status, String vendorId) throws SQLException {
        StringBuilder sql = new StringBuilder(SELECT_BASE).append("WHERE 1=1 ");
        List<Object> args = new ArrayList<>();
        if (search != null && !search.isBlank()) {
            sql.append("AND (o.order_id ILIKE ? OR o.customer_name ILIKE ? OR o.customer_phone ILIKE ?) ");
            String like = "%" + search.trim() + "%";
            args.add(like); args.add(like); args.add(like);
        }
        if (status != null) { sql.append("AND o.status = ? "); args.add(status); }
        if (vendorId != null) { sql.append("AND o.vendor_id = ?::uuid "); args.add(vendorId); }
        sql.append("ORDER BY o.created_at DESC");
        return runQuery(sql.toString(), args);
    }

    /** All orders for one customer, newest first. */
    public List<Order> listByCustomer(String customerId) throws SQLException {
        return runQuery(SELECT_BASE + "WHERE o.customer_id = ?::uuid ORDER BY o.created_at DESC",
                List.of(customerId));
    }

    private List<Order> runQuery(String sql, List<Object> args) throws SQLException {
        List<Order> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.size(); i++) ps.setObject(i + 1, args.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(map(rs));
            }
        }
        return out;
    }

    public List<OrderItem> items(String orderId) throws SQLException {
        String sql = "SELECT product_name, qty, unit_price, line_total, " +
                     "       (SELECT string_agg(key || ': ' || value, ' · ' ORDER BY key) " +
                     "          FROM jsonb_each_text(order_items.specs)) AS specs_text " +
                     "FROM order_items WHERE order_id = ? ORDER BY id";
        List<OrderItem> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new OrderItem(rs.getString("product_name"), rs.getInt("qty"),
                            rs.getBigDecimal("unit_price"), rs.getBigDecimal("line_total"),
                            rs.getString("specs_text")));
                }
            }
        }
        return out;
    }

    public List<OrderEvent> events(String orderId) throws SQLException {
        String sql = "SELECT actor, event, from_status, to_status, note, created_at " +
                     "FROM order_events WHERE order_id = ? ORDER BY created_at";
        List<OrderEvent> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, orderId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Timestamp ts = rs.getTimestamp("created_at");
                    out.add(new OrderEvent(rs.getString("actor"), rs.getString("event"),
                            rs.getString("from_status"), rs.getString("to_status"),
                            rs.getString("note"), ts == null ? null : ts.toLocalDateTime()));
                }
            }
        }
        return out;
    }

    private static Order map(ResultSet rs) throws SQLException {
        Order o = new Order();
        o.setOrderId(rs.getString("order_id"));
        o.setCustomerId(rs.getString("customer_id"));
        o.setCustomerName(rs.getString("customer_name"));
        o.setCustomerPhone(rs.getString("customer_phone"));
        o.setVendorName(rs.getString("vendor_name"));
        o.setStatus(rs.getString("status"));
        o.setPaymentMethod(rs.getString("payment_method"));
        o.setPaymentStatus(rs.getString("payment_status"));
        o.setSubtotal(rs.getBigDecimal("subtotal"));
        o.setDeliveryFee(rs.getBigDecimal("delivery_fee"));
        o.setDiscount(rs.getBigDecimal("discount_amount"));
        o.setCommissionAmount(rs.getBigDecimal("commission_amount"));
        o.setTotal(rs.getBigDecimal("total"));
        o.setReturned(rs.getBoolean("returned"));
        Timestamp ts = rs.getTimestamp("created_at");
        o.setCreatedAt(ts == null ? null : ts.toLocalDateTime());
        return o;
    }
}
