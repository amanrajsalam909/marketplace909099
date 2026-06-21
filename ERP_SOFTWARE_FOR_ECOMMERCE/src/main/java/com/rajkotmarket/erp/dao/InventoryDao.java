package com.rajkotmarket.erp.dao;

import com.rajkotmarket.erp.db.Database;
import com.rajkotmarket.erp.model.InventoryMovement;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/**
 * Stock movements against the {@code products.stock} column, with a matching
 * audit row in {@code inventory_log} — mirroring the same pattern the live
 * website uses inside its checkout/return RPCs.
 */
public class InventoryDao {

    /**
     * Atomically apply a stock change for one product and record it in
     * inventory_log. The product row is locked FOR UPDATE so concurrent
     * web orders and this adjustment cannot race.
     *
     * @param change positive = restock, negative = remove
     * @param reason free text stored in inventory_log.reason (e.g. "manual")
     * @return the resulting stock level
     * @throws SQLException if the product is missing or the change would make stock negative
     */
    public int applyChange(String productId, int change, String reason) throws SQLException {
        Connection c = Database.getConnection();
        boolean oldAuto = c.getAutoCommit();
        try {
            c.setAutoCommit(false);

            int before;
            String name;
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT name, stock FROM products WHERE id = ?::uuid FOR UPDATE")) {
                ps.setObject(1, productId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        throw new SQLException("Product not found: " + productId);
                    }
                    name = rs.getString("name");
                    before = rs.getInt("stock");
                }
            }

            int after = before + change;
            if (after < 0) {
                throw new SQLException("Stock cannot go below zero. Current stock is "
                        + before + ", requested change " + change + ".");
            }

            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE products SET stock = ?, updated_at = now() WHERE id = ?::uuid")) {
                ps.setInt(1, after);
                ps.setObject(2, productId);
                ps.executeUpdate();
            }

            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO inventory_log (product_id, product_name, change, stock_before, stock_after, reason) " +
                    "VALUES (?::uuid, ?, ?, ?, ?, ?)")) {
                ps.setObject(1, productId);
                ps.setString(2, name);
                ps.setInt(3, change);
                ps.setInt(4, before);
                ps.setInt(5, after);
                ps.setString(6, reason == null || reason.isBlank() ? "manual" : reason);
                ps.executeUpdate();
            }

            c.commit();
            return after;
        } catch (SQLException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(oldAuto);
            c.close();
        }
    }

    /** Recent movements for one product (newest first). */
    public List<InventoryMovement> history(String productId, int limit) throws SQLException {
        String sql = "SELECT product_name, change, stock_before, stock_after, reason, order_id, created_at " +
                     "FROM inventory_log WHERE product_id = ?::uuid ORDER BY created_at DESC LIMIT ?";
        List<InventoryMovement> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setObject(1, productId);
            ps.setInt(2, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Timestamp ts = rs.getTimestamp("created_at");
                    out.add(new InventoryMovement(
                            rs.getString("product_name"),
                            rs.getInt("change"),
                            rs.getInt("stock_before"),
                            rs.getInt("stock_after"),
                            rs.getString("reason"),
                            rs.getString("order_id"),
                            ts == null ? null : ts.toLocalDateTime()));
                }
            }
        }
        return out;
    }
}
