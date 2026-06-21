package com.rajkotmarket.erp.dao;

import com.rajkotmarket.erp.db.Database;
import com.rajkotmarket.erp.model.Customer;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/** Read access to the {@code customers} table. */
public class CustomerDao {

    private static final String SELECT_BASE =
            "SELECT id, name, phone, email, total_orders, total_spent, last_order_date, created_at " +
            "FROM customers ";

    /**
     * List customers with an optional search over name/phone/email.
     * @param sort one of "spent", "orders", "recent", "name" (defaults to spent)
     */
    public List<Customer> list(String search, String sort) throws SQLException {
        StringBuilder sql = new StringBuilder(SELECT_BASE).append("WHERE 1=1 ");
        List<Object> args = new ArrayList<>();
        if (search != null && !search.isBlank()) {
            sql.append("AND (name ILIKE ? OR phone ILIKE ? OR email ILIKE ?) ");
            String like = "%" + search.trim() + "%";
            args.add(like); args.add(like); args.add(like);
        }
        sql.append(switch (sort == null ? "spent" : sort) {
            case "orders" -> "ORDER BY total_orders DESC, total_spent DESC";
            case "recent" -> "ORDER BY last_order_date DESC NULLS LAST";
            case "name"   -> "ORDER BY name";
            default        -> "ORDER BY total_spent DESC";
        });

        List<Customer> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql.toString())) {
            for (int i = 0; i < args.size(); i++) ps.setObject(i + 1, args.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(map(rs));
            }
        }
        return out;
    }

    private static Customer map(ResultSet rs) throws SQLException {
        Customer c = new Customer();
        c.setId(rs.getString("id"));
        c.setName(rs.getString("name"));
        c.setPhone(rs.getString("phone"));
        c.setEmail(rs.getString("email"));
        c.setTotalOrders(rs.getInt("total_orders"));
        c.setTotalSpent(rs.getBigDecimal("total_spent"));
        Timestamp last = rs.getTimestamp("last_order_date");
        c.setLastOrderDate(last == null ? null : last.toLocalDateTime());
        Timestamp created = rs.getTimestamp("created_at");
        c.setCreatedAt(created == null ? null : created.toLocalDateTime());
        return c;
    }
}
