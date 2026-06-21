package com.rajkotmarket.erp.model;

import java.math.BigDecimal;

/**
 * A catalog product (maps to the {@code products} table).
 * Getters are named so JavaFX {@code PropertyValueFactory} can bind them.
 */
public class Product {
    private String id;            // UUID (null for a not-yet-saved product)
    private String productNo;     // auto-generated 5-char code (read-only here)
    private String vendorId;
    private String vendorName;    // joined from vendors.name (display only)
    private String name;
    private String category;
    private String description;
    private BigDecimal price = BigDecimal.ZERO;
    private int stock;
    private boolean active = true;

    public Product() { }

    public String getId()              { return id; }
    public String getProductNo()       { return productNo; }
    public String getVendorId()        { return vendorId; }
    public String getVendorName()      { return vendorName; }
    public String getName()            { return name; }
    public String getCategory()        { return category; }
    public String getDescription()     { return description; }
    public BigDecimal getPrice()       { return price; }
    public int getStock()              { return stock; }
    public boolean isActive()          { return active; }

    public void setId(String v)            { this.id = v; }
    public void setProductNo(String v)     { this.productNo = v; }
    public void setVendorId(String v)      { this.vendorId = v; }
    public void setVendorName(String v)    { this.vendorName = v; }
    public void setName(String v)          { this.name = v; }
    public void setCategory(String v)      { this.category = v; }
    public void setDescription(String v)   { this.description = v; }
    public void setPrice(BigDecimal v)     { this.price = v == null ? BigDecimal.ZERO : v; }
    public void setStock(int v)            { this.stock = v; }
    public void setActive(boolean v)       { this.active = v; }
}
