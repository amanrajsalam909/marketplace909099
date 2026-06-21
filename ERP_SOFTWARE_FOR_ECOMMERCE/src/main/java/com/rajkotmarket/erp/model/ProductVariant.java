package com.rajkotmarket.erp.model;

/**
 * One size/colour combination of a product (maps to {@code product_variants}).
 * {@code combination} is the specs pre-formatted for display (e.g.
 * "Colour: Red · Size: M"); {@code specsJson} is the raw jsonb text kept for
 * round-tripping back to the DB. {@code stock} is editable in the ERP.
 */
public class ProductVariant {
    private final String id;          // null for a new, not-yet-saved combination
    private final String combination;
    private final String specsJson;
    private int stock;

    public ProductVariant(String id, String combination, String specsJson, int stock) {
        this.id = id;
        this.combination = combination;
        this.specsJson = specsJson;
        this.stock = stock;
    }

    public String getId()          { return id; }
    public String getCombination() { return combination; }
    public String getSpecsJson()   { return specsJson; }
    public int getStock()          { return stock; }
    public void setStock(int v)    { this.stock = Math.max(0, v); }
}
