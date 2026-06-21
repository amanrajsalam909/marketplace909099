package com.rajkotmarket.erp.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** A customer (maps to the {@code customers} table). */
public class Customer {
    private String id;
    private String name;
    private String phone;
    private String email;
    private int totalOrders;
    private BigDecimal totalSpent = BigDecimal.ZERO;
    private LocalDateTime lastOrderDate;
    private LocalDateTime createdAt;

    public String getId()                 { return id; }
    public String getName()               { return name; }
    public String getPhone()              { return phone; }
    public String getEmail()              { return email; }
    public int getTotalOrders()           { return totalOrders; }
    public BigDecimal getTotalSpent()     { return totalSpent; }
    public LocalDateTime getLastOrderDate(){ return lastOrderDate; }
    public LocalDateTime getCreatedAt()   { return createdAt; }

    public void setId(String v)                  { this.id = v; }
    public void setName(String v)                { this.name = v; }
    public void setPhone(String v)               { this.phone = v; }
    public void setEmail(String v)               { this.email = v; }
    public void setTotalOrders(int v)            { this.totalOrders = v; }
    public void setTotalSpent(BigDecimal v)      { this.totalSpent = v; }
    public void setLastOrderDate(LocalDateTime v){ this.lastOrderDate = v; }
    public void setCreatedAt(LocalDateTime v)    { this.createdAt = v; }

    public String getLastOrderText() { return com.rajkotmarket.erp.util.Fmt.date(lastOrderDate); }
}
