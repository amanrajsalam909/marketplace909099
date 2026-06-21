package com.rajkotmarket.erp.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * Connection configuration for the ERP, persisted to
 * {@code ~/.rajkotmarket-erp/config.properties} (outside the repo, so secrets
 * are never committed).
 *
 * The defaults are pre-filled for the RajkotMarket Supabase project's
 * connection pooler. The user only needs to supply the database password and
 * the pooler host (copied from the Supabase dashboard → Connect → JDBC).
 */
public class AppConfig {

    private static final Path DIR  = Path.of(System.getProperty("user.home"), ".rajkotmarket-erp");
    private static final Path FILE = DIR.resolve("config.properties");

    private String host     = "aws-1-ap-southeast-1.pooler.supabase.com"; // Supabase pooler host for this project
    private String port     = "6543";                              // Supabase transaction pooler port
    private String database = "postgres";
    private String user     = "postgres.gmnlckfrkxvfftiumhwf";     // pooler user = postgres.<project-ref>
    private String password = "";
    private String sslmode  = "require";

    public static AppConfig load() {
        AppConfig c = new AppConfig();
        if (Files.exists(FILE)) {
            Properties p = new Properties();
            try (InputStream in = Files.newInputStream(FILE)) {
                p.load(in);
            } catch (IOException e) {
                System.err.println("Could not read config: " + e.getMessage());
            }
            c.host     = p.getProperty("db.host", c.host);
            c.port     = p.getProperty("db.port", c.port);
            c.database = p.getProperty("db.database", c.database);
            c.user     = p.getProperty("db.user", c.user);
            c.password = p.getProperty("db.password", c.password);
            c.sslmode  = p.getProperty("db.sslmode", c.sslmode);
        }
        return c;
    }

    public void save() {
        Properties p = new Properties();
        p.setProperty("db.host", host);
        p.setProperty("db.port", port);
        p.setProperty("db.database", database);
        p.setProperty("db.user", user);
        p.setProperty("db.password", password);
        p.setProperty("db.sslmode", sslmode);
        try {
            Files.createDirectories(DIR);
            try (OutputStream out = Files.newOutputStream(FILE)) {
                p.store(out, "RajkotMarket ERP connection settings");
            }
        } catch (IOException e) {
            throw new RuntimeException("Could not save config to " + FILE + ": " + e.getMessage(), e);
        }
    }

    public boolean isComplete() {
        return notBlank(host) && notBlank(port) && notBlank(database)
            && notBlank(user) && notBlank(password);
    }

    /** Builds the PostgreSQL JDBC URL for these settings. */
    public String jdbcUrl() {
        return "jdbc:postgresql://" + host + ":" + port + "/" + database + "?sslmode=" + sslmode;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    // -- getters / setters --------------------------------------------------
    public String getHost()     { return host; }
    public String getPort()     { return port; }
    public String getDatabase() { return database; }
    public String getUser()     { return user; }
    public String getPassword() { return password; }
    public String getSslmode()  { return sslmode; }

    public void setHost(String v)     { this.host = v == null ? "" : v.trim(); }
    public void setPort(String v)     { this.port = v == null ? "" : v.trim(); }
    public void setDatabase(String v) { this.database = v == null ? "" : v.trim(); }
    public void setUser(String v)     { this.user = v == null ? "" : v.trim(); }
    public void setPassword(String v) { this.password = v == null ? "" : v; }
    public void setSslmode(String v)  { this.sslmode = v == null ? "require" : v.trim(); }
}
