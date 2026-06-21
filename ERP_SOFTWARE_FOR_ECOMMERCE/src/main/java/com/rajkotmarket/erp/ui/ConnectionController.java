package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.App;
import com.rajkotmarket.erp.config.AppConfig;
import com.rajkotmarket.erp.db.Database;
import javafx.application.Platform;
import javafx.concurrent.Task;
import javafx.fxml.FXML;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.TextField;

/** First-run screen: enter Supabase PostgreSQL connection details and test them. */
public class ConnectionController {

    @FXML private TextField hostField;
    @FXML private TextField portField;
    @FXML private TextField databaseField;
    @FXML private TextField userField;
    @FXML private PasswordField passwordField;
    @FXML private Label statusLabel;
    @FXML private Button connectButton;

    @FXML
    private void initialize() {
        AppConfig c = AppConfig.load();
        hostField.setText(c.getHost());
        portField.setText(c.getPort());
        databaseField.setText(c.getDatabase());
        userField.setText(c.getUser());
        passwordField.setText(c.getPassword());
    }

    @FXML
    private void onConnect() {
        AppConfig c = new AppConfig();
        c.setHost(hostField.getText());
        c.setPort(portField.getText());
        c.setDatabase(databaseField.getText());
        c.setUser(userField.getText());
        c.setPassword(passwordField.getText());

        if (!c.isComplete()) {
            setStatus("Please fill in host, port, database, user and password.", true);
            return;
        }

        connectButton.setDisable(true);
        setStatus("Connecting to " + c.getHost() + " …", false);

        Task<Void> task = new Task<>() {
            @Override protected Void call() throws Exception {
                Database.init(c);   // throws on failure
                return null;
            }
        };
        task.setOnSucceeded(e -> {
            c.save();
            try {
                App.showMain();
            } catch (Exception ex) {
                setStatus("Connected, but failed to open the app: " + ex.getMessage(), true);
                connectButton.setDisable(false);
            }
        });
        task.setOnFailed(e -> {
            Throwable ex = task.getException();
            setStatus("Connection failed: " + (ex == null ? "unknown error" : ex.getMessage()), true);
            connectButton.setDisable(false);
        });
        Thread t = new Thread(task, "db-connect");
        t.setDaemon(true);
        t.start();
    }

    private void setStatus(String msg, boolean error) {
        Platform.runLater(() -> {
            statusLabel.setText(msg);
            statusLabel.getStyleClass().removeAll("status-error", "status-info");
            statusLabel.getStyleClass().add(error ? "status-error" : "status-info");
        });
    }
}
