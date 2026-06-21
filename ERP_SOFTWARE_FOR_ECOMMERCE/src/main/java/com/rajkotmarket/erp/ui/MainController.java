package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.App;
import com.rajkotmarket.erp.db.Database;
import javafx.fxml.FXML;
import javafx.fxml.FXMLLoader;
import javafx.scene.Node;
import javafx.scene.control.Label;
import javafx.scene.control.ToggleButton;
import javafx.scene.control.ToggleGroup;
import javafx.scene.layout.BorderPane;

/** The ERP shell: left navigation + a swappable content area. */
public class MainController {

    @FXML private BorderPane root;
    @FXML private Label statusBar;
    @FXML private ToggleButton navDashboard;
    @FXML private ToggleButton navOrders;
    @FXML private ToggleButton navCustomers;
    @FXML private ToggleButton navProducts;
    @FXML private ToggleButton navLowStock;
    @FXML private ToggleGroup navGroup;

    @FXML
    private void initialize() {
        // Keep one nav item always selected.
        navGroup.selectedToggleProperty().addListener((obs, oldT, newT) -> {
            if (newT == null && oldT != null) oldT.setSelected(true);
        });
        navDashboard.setSelected(true);
        showDashboard();
        statusBar.setText("Connected to RajkotMarket database");
    }

    @FXML
    private void showDashboard() {
        loadView("/fxml/dashboard.fxml", false);
    }

    @FXML
    private void showOrders() {
        loadView("/fxml/orders.fxml", false);
    }

    @FXML
    private void showCustomers() {
        loadView("/fxml/customers.fxml", false);
    }

    @FXML
    private void showProducts() {
        loadView("/fxml/products.fxml", false);
    }

    @FXML
    private void showLowStock() {
        loadView("/fxml/products.fxml", true);
    }

    @FXML
    private void onReconnect() {
        Database.shutdown();
        try {
            App.showConnection();
        } catch (Exception e) {
            statusBar.setText("Could not open connection screen: " + e.getMessage());
        }
    }

    private void loadView(String fxml, boolean lowStockOnly) {
        try {
            FXMLLoader loader = new FXMLLoader(getClass().getResource(fxml));
            Node view = loader.load();
            Object controller = loader.getController();
            if (controller instanceof ProductsController pc) {
                pc.setLowStockMode(lowStockOnly);
            }
            root.setCenter(view);
        } catch (Exception e) {
            statusBar.setText("Failed to load view: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
