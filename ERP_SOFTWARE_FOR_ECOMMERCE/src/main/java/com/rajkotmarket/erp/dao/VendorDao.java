package com.rajkotmarket.erp.dao;

import com.rajkotmarket.erp.db.Database;
import com.rajkotmarket.erp.model.Vendor;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** Read access to the {@code vendors} table. */
public class VendorDao {

    /** All vendors, active first, alphabetical. */
    public List<Vendor> listAll() throws SQLException {
        String sql = "SELECT id, name, is_active FROM vendors ORDER BY is_active DESC, name";
        List<Vendor> out = new ArrayList<>();
        try (Connection c = Database.getConnection();
             PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                out.add(new Vendor(
                        rs.getString("id"),
                        rs.getString("name"),
                        rs.getBoolean("is_active")));
            }
        }
        return out;
    }
}
