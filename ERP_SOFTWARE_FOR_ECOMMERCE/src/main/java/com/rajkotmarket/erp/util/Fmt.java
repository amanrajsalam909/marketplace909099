package com.rajkotmarket.erp.util;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Shared display formatting (Indian rupee + dates). */
public final class Fmt {
    private static final Locale INDIA = new Locale("en", "IN");
    private static final DateTimeFormatter DT = DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm");
    private static final DateTimeFormatter D  = DateTimeFormatter.ofPattern("dd MMM yyyy");

    private Fmt() { }

    public static String money(BigDecimal v) {
        if (v == null) v = BigDecimal.ZERO;
        NumberFormat nf = NumberFormat.getInstance(INDIA);
        nf.setMinimumFractionDigits(2);
        nf.setMaximumFractionDigits(2);
        return "₹" + nf.format(v);
    }

    public static String dateTime(LocalDateTime t) { return t == null ? "" : DT.format(t); }
    public static String date(LocalDateTime t)     { return t == null ? "" : D.format(t); }
}
