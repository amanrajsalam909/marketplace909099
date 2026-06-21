package com.rajkotmarket.erp.dao;

import com.rajkotmarket.erp.db.Database;
import com.rajkotmarket.erp.model.Kpis;
import com.rajkotmarket.erp.model.NameValue;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only aggregate queries that power the dashboard. Revenue is recognised on
 * DELIVERED orders only — the same rule the website's accounting functions use.
 */
public class AnalyticsDao {

    private static final int LOW_STOCK = 10;

    /** All headline metrics in a handful of cheap aggregate queries. */
    public Kpis kpis() throws SQLException {
        Kpis k = new Kpis();
        try (Connection c = Database.getConnection(); Statement s = c.createStatement()) {

            try (ResultSet r = s.executeQuery(
                    "SELECT " +
                    " count(*) FILTER (WHERE status='delivered') AS delivered, " +
                    " count(*) AS total, " +
                    " count(*) FILTER (WHERE status='cancelled') AS cancelled, " +
                    " coalesce(sum(total) FILTER (WHERE status='delivered'),0) AS gmv, " +
                    " coalesce(sum(commission_amount) FILTER (WHERE status='delivered'),0) AS commission, " +
                    " coalesce(sum((subtotal+delivery_fee-commission_amount)) FILTER (WHERE status='delivered'),0) AS payout " +
                    "FROM orders")) {
                if (r.next()) {
                    k.deliveredOrders = r.getLong("delivered");
                    k.totalOrders = r.getLong("total");
                    k.cancelledOrders = r.getLong("cancelled");
                    k.gmv = r.getBigDecimal("gmv");
                    k.commission = r.getBigDecimal("commission");
                    k.vendorPayout = r.getBigDecimal("payout");
                }
            }
            k.avgOrderValue = k.deliveredOrders > 0
                    ? k.gmv.divide(BigDecimal.valueOf(k.deliveredOrders), 2, java.math.RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;

            try (ResultSet r = s.executeQuery("SELECT count(*) n, coalesce(sum(total_spent),0) FROM customers")) {
                if (r.next()) k.customers = r.getLong(1);
            }
            try (ResultSet r = s.executeQuery(
                    "SELECT count(*) AS n, " +
                    " count(*) FILTER (WHERE stock <= " + LOW_STOCK + ") AS low, " +
                    " coalesce(sum(price*stock),0) AS invval FROM products")) {
                if (r.next()) {
                    k.products = r.getLong("n");
                    k.lowStock = r.getLong("low");
                    k.inventoryValue = r.getBigDecimal("invval");
                }
            }
            k.openReturns = safeCount(c, "return_requests");
            k.openComplaints = safeCount(c, "complaints");
        }
        return k;
    }

    /** Daily delivered-order revenue for the last {@code days} days, zero-filled. */
    public List<NameValue> revenueByDay(int days) throws SQLException {
        Map<String, Double> byDay = new LinkedHashMap<>();
        DateTimeFormatter label = DateTimeFormatter.ofPattern("dd MMM");
        LocalDate start = LocalDate.now().minusDays(days - 1L);
        for (int i = 0; i < days; i++) {
            byDay.put(start.plusDays(i).format(label), 0.0);
        }
        String sql =
            "SELECT to_char(created_at::date,'DD Mon') AS d, coalesce(sum(total),0) AS rev " +
            "FROM orders WHERE status='delivered' AND created_at >= ?::date " +
            "GROUP BY created_at::date ORDER BY created_at::date";
        try (Connection c = Database.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setObject(1, start);
            try (ResultSet r = ps.executeQuery()) {
                while (r.next()) {
                    String d = r.getString("d");
                    if (byDay.containsKey(d)) byDay.put(d, r.getDouble("rev"));
                }
            }
        }
        List<NameValue> out = new ArrayList<>();
        byDay.forEach((d, v) -> out.add(new NameValue(d, v)));
        return out;
    }

    /** Order counts grouped by status (all orders). */
    public List<NameValue> ordersByStatus() throws SQLException {
        return simpleList("SELECT status, count(*) FROM orders GROUP BY status ORDER BY count(*) DESC");
    }

    /** Gross delivered revenue per shop. */
    public List<NameValue> revenueByVendor() throws SQLException {
        return simpleList(
            "SELECT v.name, coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0) AS rev " +
            "FROM vendors v LEFT JOIN orders o ON o.vendor_id = v.id " +
            "GROUP BY v.name ORDER BY rev DESC");
    }

    /** Top products by units sold. */
    public List<NameValue> topProducts(int limit) throws SQLException {
        return simpleList(
            "SELECT product_name, sum(qty) AS units FROM order_items " +
            "GROUP BY product_name ORDER BY units DESC LIMIT " + limit);
    }

    /** Inventory value (₹) per category. */
    public List<NameValue> inventoryValueByCategory() throws SQLException {
        return simpleList(
            "SELECT coalesce(category,'(uncategorised)') AS c, coalesce(sum(price*stock),0) AS val " +
            "FROM products GROUP BY category ORDER BY val DESC");
    }

    // -- helpers ------------------------------------------------------------

    /** Runs a 2-column (text, number) query into a NameValue list. */
    private List<NameValue> simpleList(String sql) throws SQLException {
        List<NameValue> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             Statement s = c.createStatement();
             ResultSet r = s.executeQuery(sql)) {
            while (r.next()) {
                String name = r.getString(1);
                out.add(new NameValue(name == null ? "(none)" : name, r.getDouble(2)));
            }
        }
        return out;
    }

    /** Count rows in a table that may not exist on every deployment. */
    private long safeCount(Connection c, String table) {
        try (Statement s = c.createStatement();
             ResultSet r = s.executeQuery("SELECT count(*) FROM " + table)) {
            return r.next() ? r.getLong(1) : 0;
        } catch (SQLException e) {
            return 0;
        }
    }
}
