package com.rajkotmarket.erp.model;

import java.math.BigDecimal;

/** Headline business metrics shown as cards on the dashboard. */
public class Kpis {
    public BigDecimal gmv = BigDecimal.ZERO;            // total value of delivered orders
    public BigDecimal commission = BigDecimal.ZERO;     // platform commission earned (delivered)
    public BigDecimal vendorPayout = BigDecimal.ZERO;   // owed to shops (delivered)
    public long deliveredOrders;
    public long totalOrders;
    public long cancelledOrders;
    public BigDecimal avgOrderValue = BigDecimal.ZERO;
    public long customers;
    public long products;
    public long lowStock;
    public BigDecimal inventoryValue = BigDecimal.ZERO; // sum(price * stock)
    public long openReturns;
    public long openComplaints;
}
