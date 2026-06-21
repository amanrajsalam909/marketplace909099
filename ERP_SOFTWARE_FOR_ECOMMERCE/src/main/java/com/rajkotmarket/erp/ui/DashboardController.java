package com.rajkotmarket.erp.ui;

import com.rajkotmarket.erp.dao.AnalyticsDao;
import com.rajkotmarket.erp.model.Kpis;
import com.rajkotmarket.erp.model.NameValue;
import javafx.application.Platform;
import javafx.collections.FXCollections;
import javafx.concurrent.Task;
import javafx.fxml.FXML;
import javafx.scene.chart.AreaChart;
import javafx.scene.chart.BarChart;
import javafx.scene.chart.CategoryAxis;
import javafx.scene.chart.PieChart;
import javafx.scene.chart.XYChart;
import javafx.scene.control.Alert;
import javafx.scene.control.ButtonType;
import javafx.scene.control.Label;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * Analytics dashboard: headline KPI cards plus five charts (revenue trend,
 * orders by status, revenue by shop, top products, inventory value by category).
 * All data is loaded off the UI thread in a single batch.
 */
public class DashboardController {

    @FXML private FlowPane kpiPane;
    @FXML private AreaChart<String, Number> revenueChart;
    @FXML private PieChart statusChart;
    @FXML private BarChart<Number, String> vendorChart;       // horizontal
    @FXML private BarChart<Number, String> topProductsChart;  // horizontal
    @FXML private BarChart<Number, String> categoryChart;     // horizontal
    @FXML private Label updatedLabel;

    private final AnalyticsDao dao = new AnalyticsDao();
    private static final Locale INDIA = new Locale("en", "IN");
    private static final int REVENUE_DAYS = 14;

    /** Bundle of everything the dashboard needs, fetched in one background pass. */
    private static final class Data {
        Kpis kpis;
        List<NameValue> revenue, status, vendor, topProducts, category;
    }

    @FXML
    private void initialize() {
        revenueChart.setLegendVisible(false);
        vendorChart.setLegendVisible(false);
        topProductsChart.setLegendVisible(false);
        categoryChart.setLegendVisible(false);
        revenueChart.setTitle("Revenue — last " + REVENUE_DAYS + " days (delivered)");

        // Disable animation on every chart AND its axes. Animated charts re-layout
        // their tick labels asynchronously, which leaves the category/date labels
        // overlapping when data is (re)loaded. Static charts lay out cleanly.
        for (var chart : new javafx.scene.chart.Chart[]{
                revenueChart, statusChart, vendorChart, topProductsChart, categoryChart}) {
            chart.setAnimated(false);
        }
        for (var axis : new javafx.scene.chart.Axis[]{
                revenueChart.getXAxis(), revenueChart.getYAxis(),
                vendorChart.getXAxis(), vendorChart.getYAxis(),
                topProductsChart.getXAxis(), topProductsChart.getYAxis(),
                categoryChart.getXAxis(), categoryChart.getYAxis()}) {
            axis.setAnimated(false);
        }

        // Rotate the daily x-axis labels so 14 dates don't overlap.
        if (revenueChart.getXAxis() instanceof CategoryAxis ca) {
            ca.setTickLabelRotation(90);
            ca.setTickLabelGap(2);
        }
        // Give the horizontal bars a little breathing room.
        vendorChart.setBarGap(2);
        topProductsChart.setBarGap(2);
        categoryChart.setBarGap(2);
        refresh();
    }

    @FXML
    private void refresh() {
        Task<Data> t = new Task<>() {
            @Override protected Data call() throws Exception {
                Data d = new Data();
                d.kpis = dao.kpis();
                d.revenue = dao.revenueByDay(REVENUE_DAYS);
                d.status = dao.ordersByStatus();
                d.vendor = dao.revenueByVendor();
                d.topProducts = dao.topProducts(8);
                d.category = dao.inventoryValueByCategory();
                return d;
            }
        };
        t.setOnSucceeded(e -> render(t.getValue()));
        t.setOnFailed(e -> {
            Throwable ex = t.getException();
            Alert a = new Alert(Alert.AlertType.ERROR,
                    ex == null ? "Unknown error" : ex.getMessage(), ButtonType.OK);
            a.setHeaderText("Could not load dashboard");
            a.showAndWait();
        });
        Thread th = new Thread(t, "dashboard-load");
        th.setDaemon(true);
        th.start();
    }

    private void render(Data d) {
        Platform.runLater(() -> {
            buildKpis(d.kpis);
            fillArea(revenueChart, d.revenue);
            fillPie(statusChart, d.status);
            fillBarH(vendorChart, d.vendor);
            fillBarH(topProductsChart, d.topProducts);
            fillBarH(categoryChart, d.category);
            updatedLabel.setText("Updated " + LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")));
        });
    }

    // -- KPI cards ----------------------------------------------------------

    private void buildKpis(Kpis k) {
        kpiPane.getChildren().setAll(
                card("Revenue (GMV)", money(k.gmv), "delivered orders", "kpi-green"),
                card("Delivered Orders", String.valueOf(k.deliveredOrders),
                        k.totalOrders + " total · " + k.cancelledOrders + " cancelled", "kpi-blue"),
                card("Avg Order Value", money(k.avgOrderValue), "per delivered order", "kpi-blue"),
                card("Commission", money(k.commission), "platform earnings", "kpi-green"),
                card("Vendor Payout", money(k.vendorPayout), "owed to shops", "kpi-amber"),
                card("Customers", String.valueOf(k.customers), "registered", "kpi-blue"),
                card("Products", String.valueOf(k.products), k.lowStock + " low on stock", "kpi-blue"),
                card("Inventory Value", money(k.inventoryValue), "price × stock", "kpi-green"),
                card("Returns", String.valueOf(k.openReturns), "requests", "kpi-amber"),
                card("Complaints", String.valueOf(k.openComplaints), "logged", "kpi-red")
        );
    }

    private VBox card(String title, String value, String sub, String accent) {
        Label t = new Label(title.toUpperCase());
        t.getStyleClass().add("kpi-title");
        Label v = new Label(value);
        v.getStyleClass().add("kpi-value");
        Label s = new Label(sub);
        s.getStyleClass().add("kpi-sub");
        VBox box = new VBox(4, t, v, s);
        box.getStyleClass().addAll("kpi-card", accent);
        return box;
    }

    // -- chart fillers ------------------------------------------------------

    private void fillArea(AreaChart<String, Number> chart, List<NameValue> data) {
        XYChart.Series<String, Number> series = new XYChart.Series<>();
        for (NameValue nv : data) {
            series.getData().add(new XYChart.Data<>(nv.name(), nv.value()));
        }
        chart.setData(FXCollections.observableArrayList(series));
    }

    /**
     * Horizontal bar chart (value on X, label on Y). Data is supplied largest-first;
     * we add it in reverse so the biggest bar ends up at the TOP of the axis.
     */
    private void fillBarH(BarChart<Number, String> chart, List<NameValue> data) {
        XYChart.Series<Number, String> series = new XYChart.Series<>();
        for (int i = data.size() - 1; i >= 0; i--) {
            NameValue nv = data.get(i);
            series.getData().add(new XYChart.Data<>(nv.value(), nv.name()));
        }
        chart.setData(FXCollections.observableArrayList(series));
    }

    private void fillPie(PieChart chart, List<NameValue> data) {
        var slices = FXCollections.<PieChart.Data>observableArrayList();
        for (NameValue nv : data) {
            if (nv.value() > 0) slices.add(new PieChart.Data(nv.name() + " (" + trim(nv.value()) + ")", nv.value()));
        }
        chart.setData(slices);
    }

    // -- formatting ---------------------------------------------------------

    private static String money(BigDecimal v) {
        if (v == null) v = BigDecimal.ZERO;
        NumberFormat nf = NumberFormat.getInstance(INDIA);
        nf.setMaximumFractionDigits(0);
        return "₹" + nf.format(v);
    }

    private static String trim(double d) {
        return d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d);
    }
}
