package com.rajkotmarket.erp.model;

/**
 * One size/colour combination of a product (maps to {@code product_variants}).
 * {@code combination} is the specs pre-formatted for display, e.g.
 * "Colour: Red · Size: M".
 */
public class ProductVariant {
    private final String combination;
    private final int stock;

    public ProductVariant(String combination, int stock) {
        this.combination = combination;
        this.stock = stock;
    }

    public String getCombination() { return combination; }
    public int getStock()          { return stock; }
}
