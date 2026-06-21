package com.rajkotmarket.erp.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** A customer order (maps to the {@code orders} table, joined with vendor name). */
public class Order {
    private String orderId;
    private String customerId;
    private String customerName;
    private String customerPhone;
    private String vendorName;
    private String status;
    private String paymentMethod;
    private String paymentStatus;
    private BigDecimal subtotal = BigDecimal.ZERO;
    private BigDecimal deliveryFee = BigDecimal.ZERO;
    private BigDecimal discount = BigDecimal.ZERO;
    private BigDecimal commissionAmount = BigDecimal.ZERO;
    private BigDecimal total = BigDecimal.ZERO;
    private boolean returned;
    private LocalDateTime createdAt;

    public String getOrderId()             { return orderId; }
    public String getCustomerId()          { return customerId; }
    public String getCustomerName()        { return customerName; }
    public String getCustomerPhone()       { return customerPhone; }
    public String getVendorName()          { return vendorName; }
    public String getStatus()              { return status; }
    public String getPaymentMethod()       { return paymentMethod; }
    public String getPaymentStatus()       { return paymentStatus; }
    public BigDecimal getSubtotal()        { return subtotal; }
    public BigDecimal getDeliveryFee()     { return deliveryFee; }
    public BigDecimal getDiscount()        { return discount; }
    public BigDecimal getCommissionAmount(){ return commissionAmount; }
    public BigDecimal getTotal()           { return total; }
    public boolean isReturned()            { return returned; }
    public LocalDateTime getCreatedAt()    { return createdAt; }

    public void setOrderId(String v)             { this.orderId = v; }
    public void setCustomerId(String v)          { this.customerId = v; }
    public void setCustomerName(String v)        { this.customerName = v; }
    public void setCustomerPhone(String v)       { this.customerPhone = v; }
    public void setVendorName(String v)          { this.vendorName = v; }
    public void setStatus(String v)              { this.status = v; }
    public void setPaymentMethod(String v)       { this.paymentMethod = v; }
    public void setPaymentStatus(String v)       { this.paymentStatus = v; }
    public void setSubtotal(BigDecimal v)        { this.subtotal = v; }
    public void setDeliveryFee(BigDecimal v)     { this.deliveryFee = v; }
    public void setDiscount(BigDecimal v)        { this.discount = v; }
    public void setCommissionAmount(BigDecimal v){ this.commissionAmount = v; }
    public void setTotal(BigDecimal v)           { this.total = v; }
    public void setReturned(boolean v)           { this.returned = v; }
    public void setCreatedAt(LocalDateTime v)    { this.createdAt = v; }

    /** For PropertyValueFactory("createdAtText"). */
    public String getCreatedAtText() { return com.rajkotmarket.erp.util.Fmt.dateTime(createdAt); }
}
