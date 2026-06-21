package com.rajkotmarket.erp;

import com.rajkotmarket.erp.config.AppConfig;
import com.rajkotmarket.erp.db.Database;
import javafx.application.Application;
import javafx.fxml.FXMLLoader;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.stage.Stage;

/**
 * JavaFX application entry point for the RajkotMarket ERP.
 *
 * Flow on launch:
 *   1. Load saved connection config from ~/.rajkotmarket-erp/config.properties.
 *   2. If incomplete OR the DB is unreachable, show the connection-settings screen.
 *   3. Otherwise open the main ERP shell.
 */
public class App extends Application {

    private static Stage primaryStage;

    @Override
    public void start(Stage stage) throws Exception {
        primaryStage = stage;
        stage.setTitle("RajkotMarket ERP");

        AppConfig config = AppConfig.load();
        if (config.isComplete() && Database.tryInit(config)) {
            showMain();
        } else {
            showConnection();
        }
    }

    /** Show the connection-settings screen (first run or after a failed connect). */
    public static void showConnection() throws Exception {
        FXMLLoader loader = new FXMLLoader(App.class.getResource("/fxml/connection.fxml"));
        Parent root = loader.load();
        setScene(root, 560, 600);
    }

    /** Show the main ERP shell once a database connection is established. */
    public static void showMain() throws Exception {
        FXMLLoader loader = new FXMLLoader(App.class.getResource("/fxml/main.fxml"));
        Parent root = loader.load();
        setScene(root, 1180, 760);
        primaryStage.setMaximized(true);
    }

    private static void setScene(Parent root, double w, double h) {
        Scene scene = primaryStage.getScene();
        if (scene == null) {
            scene = new Scene(root, w, h);
            scene.getStylesheets().add(App.class.getResource("/css/app.css").toExternalForm());
            primaryStage.setScene(scene);
        } else {
            scene.setRoot(root);
        }
        primaryStage.show();
    }

    @Override
    public void stop() {
        Database.shutdown();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
