package com.rajkotmarket.erp.db;

import com.rajkotmarket.erp.config.AppConfig;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import java.sql.Connection;
import java.sql.SQLException;

/**
 * Owns the single application-wide HikariCP connection pool to the Supabase
 * PostgreSQL database. All DAOs borrow connections from here.
 */
public final class Database {

    private static HikariDataSource ds;

    private Database() { }

    /**
     * Initialise the pool and verify connectivity. Returns {@code true} if a
     * live connection was obtained; on any failure it logs and returns
     * {@code false} (so the UI can fall back to the connection screen).
     */
    public static boolean tryInit(AppConfig config) {
        try {
            init(config);
            return true;
        } catch (Exception e) {
            System.err.println("Database connect failed: " + e.getMessage());
            shutdown();
            return false;
        }
    }

    /** Initialise the pool, throwing if the connection cannot be established. */
    public static synchronized void init(AppConfig config) throws SQLException {
        shutdown();
        HikariConfig hc = new HikariConfig();
        hc.setJdbcUrl(config.jdbcUrl());
        hc.setUsername(config.getUser());
        hc.setPassword(config.getPassword());
        hc.setDriverClassName("org.postgresql.Driver");
        hc.setMaximumPoolSize(4);
        hc.setMinimumIdle(1);
        hc.setConnectionTimeout(10_000);     // fail fast if the host is wrong
        hc.setPoolName("rajkotmarket-erp");
        // Supabase's transaction pooler does not support server-side prepared
        // statements; disable them so queries work on both pooler and direct.
        hc.addDataSourceProperty("prepareThreshold", "0");

        HikariDataSource candidate = new HikariDataSource(hc);
        try (Connection c = candidate.getConnection()) {
            c.isValid(5);
        } catch (SQLException e) {
            candidate.close();
            throw e;
        }
        ds = candidate;
    }

    public static Connection getConnection() throws SQLException {
        if (ds == null) {
            throw new SQLException("Database pool is not initialised.");
        }
        return ds.getConnection();
    }

    public static boolean isReady() {
        return ds != null && !ds.isClosed();
    }

    public static synchronized void shutdown() {
        if (ds != null) {
            ds.close();
            ds = null;
        }
    }
}
