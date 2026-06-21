package com.rajkotmarket.erp.model;

/** A shop/seller on the marketplace (maps to the {@code vendors} table). */
public class Vendor {
    private final String id;
    private final String name;
    private final boolean active;

    public Vendor(String id, String name, boolean active) {
        this.id = id;
        this.name = name;
        this.active = active;
    }

    public String getId()      { return id; }
    public String getName()    { return name; }
    public boolean isActive()  { return active; }

    /** ComboBox renders this. */
    @Override public String toString() { return name; }
}
