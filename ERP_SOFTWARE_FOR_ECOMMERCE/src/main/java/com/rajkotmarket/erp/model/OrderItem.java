package com.rajkotmarket.erp.model;

import java.math.BigDecimal;

/** One line item of an order (maps to {@code order_items}). */
public class OrderItem {
    private final String productName;
    private final int qty;
    private final BigDecimal unitPrice;
    private final BigDecimal lineTotal;
    private final String specs;   // chosen size/colour, e.g. "Size: M · Colour: Red" (null when none)

    public OrderItem(String productName, int qty, BigDecimal unitPrice, BigDecimal lineTotal, String specs) {
        this.productName = productName;
        this.qty = qty;
        this.unitPrice = unitPrice;
        this.lineTotal = lineTotal;
        this.specs = specs;
    }

    public String getProductName()   { return productName; }
    public int getQty()              { return qty; }
    public BigDecimal getUnitPrice() { return unitPrice; }
    public BigDecimal getLineTotal() { return lineTotal; }
    public String getSpecs()         { return specs; }
}
