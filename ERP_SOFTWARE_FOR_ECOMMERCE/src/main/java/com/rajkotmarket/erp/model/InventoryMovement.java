package com.rajkotmarket.erp.model;

import java.time.LocalDateTime;

/** One row of the {@code inventory_log} stock-movement audit trail. */
public class InventoryMovement {
    private final String productName;
    private final int change;
    private final int stockBefore;
    private final int stockAfter;
    private final String reason;
    private final String orderId;
    private final LocalDateTime createdAt;

    public InventoryMovement(String productName, int change, int stockBefore,
                             int stockAfter, String reason, String orderId,
                             LocalDateTime createdAt) {
        this.productName = productName;
        this.change = change;
        this.stockBefore = stockBefore;
        this.stockAfter = stockAfter;
        this.reason = reason;
        this.orderId = orderId;
        this.createdAt = createdAt;
    }

    public String getProductName()     { return productName; }
    public int getChange()             { return change; }
    public int getStockBefore()        { return stockBefore; }
    public int getStockAfter()         { return stockAfter; }
    public String getReason()          { return reason; }
    public String getOrderId()         { return orderId; }
    public LocalDateTime getCreatedAt(){ return createdAt; }
}
