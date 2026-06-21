package com.rajkotmarket.erp.util;

import com.github.miachm.sods.Sheet;
import com.github.miachm.sods.SpreadSheet;
import javafx.scene.Node;
import javafx.scene.control.Alert;
import javafx.scene.control.ButtonType;
import javafx.stage.FileChooser;
import javafx.stage.Window;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.Writer;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

/**
 * Exports tabular data to Excel (.xlsx), LibreOffice/OpenDocument (.ods) or CSV.
 * Numeric cells (Number/BigDecimal) are written as real numbers so totals can be
 * summed in the spreadsheet; everything else is written as text.
 */
public final class Exporter {

    private Exporter() { }

    /** Show a Save dialog and export to the format implied by the chosen extension. */
    public static void chooseAndExport(Node anchor, String suggestedName, String sheetName,
                                       List<String> headers, List<List<Object>> rows) {
        Window owner = (anchor != null && anchor.getScene() != null) ? anchor.getScene().getWindow() : null;

        FileChooser fc = new FileChooser();
        fc.setTitle("Export");
        fc.setInitialFileName(suggestedName);
        var fXlsx = new FileChooser.ExtensionFilter("Excel workbook (*.xlsx)", "*.xlsx");
        var fOds  = new FileChooser.ExtensionFilter("LibreOffice / OpenDocument (*.ods)", "*.ods");
        var fCsv  = new FileChooser.ExtensionFilter("CSV — opens anywhere (*.csv)", "*.csv");
        fc.getExtensionFilters().addAll(fXlsx, fOds, fCsv);
        fc.setSelectedExtensionFilter(fXlsx);

        File file = fc.showSaveDialog(owner);
        if (file == null) return;

        String fmt = formatOf(file, fc.getSelectedExtensionFilter());
        file = ensureExtension(file, fmt);

        try {
            switch (fmt) {
                case "ods" -> writeOds(file, sheetName, headers, rows);
                case "csv" -> writeCsv(file, headers, rows);
                default     -> writeXlsx(file, sheetName, headers, rows);
            }
            alert(Alert.AlertType.INFORMATION, "Export complete",
                    rows.size() + " row(s) exported to:\n" + file.getAbsolutePath());
        } catch (Exception e) {
            alert(Alert.AlertType.ERROR, "Export failed", String.valueOf(e.getMessage()));
        }
    }

    // -- format helpers -----------------------------------------------------

    private static String formatOf(File f, FileChooser.ExtensionFilter selected) {
        String n = f.getName().toLowerCase();
        if (n.endsWith(".xlsx")) return "xlsx";
        if (n.endsWith(".ods")) return "ods";
        if (n.endsWith(".csv")) return "csv";
        if (selected != null) {
            String d = selected.getDescription().toLowerCase();
            if (d.contains("opendocument")) return "ods";
            if (d.contains("csv")) return "csv";
        }
        return "xlsx";
    }

    private static File ensureExtension(File f, String fmt) {
        String n = f.getName().toLowerCase();
        return n.endsWith("." + fmt) ? f : new File(f.getParentFile(), f.getName() + "." + fmt);
    }

    // -- writers ------------------------------------------------------------

    private static void writeXlsx(File file, String sheetName, List<String> headers,
                                  List<List<Object>> rows) throws Exception {
        try (Workbook wb = new XSSFWorkbook(); OutputStream out = new FileOutputStream(file)) {
            org.apache.poi.ss.usermodel.Sheet sheet = wb.createSheet(safeSheet(sheetName));

            Font bold = wb.createFont();
            bold.setBold(true);
            var headStyle = wb.createCellStyle();
            headStyle.setFont(bold);

            Row head = sheet.createRow(0);
            for (int c = 0; c < headers.size(); c++) {
                Cell cell = head.createCell(c);
                cell.setCellValue(headers.get(c));
                cell.setCellStyle(headStyle);
            }
            for (int r = 0; r < rows.size(); r++) {
                Row row = sheet.createRow(r + 1);
                List<Object> values = rows.get(r);
                for (int c = 0; c < values.size(); c++) {
                    Cell cell = row.createCell(c);
                    Object v = values.get(c);
                    if (v instanceof Number num) cell.setCellValue(num.doubleValue());
                    else if (v != null) cell.setCellValue(v.toString());
                }
            }
            // Fixed widths (autoSizeColumn needs AWT and can fail on headless servers).
            for (int c = 0; c < headers.size(); c++) sheet.setColumnWidth(c, 18 * 256);
            sheet.createFreezePane(0, 1);
            wb.write(out);
        }
    }

    private static void writeOds(File file, String sheetName, List<String> headers,
                                 List<List<Object>> rows) throws Exception {
        Sheet sheet = new Sheet(safeSheet(sheetName), rows.size() + 1, Math.max(1, headers.size()));
        for (int c = 0; c < headers.size(); c++) {
            sheet.getRange(0, c).setValue(headers.get(c));
        }
        for (int r = 0; r < rows.size(); r++) {
            List<Object> values = rows.get(r);
            for (int c = 0; c < values.size(); c++) {
                Object v = values.get(c);
                Object cell = (v instanceof Number num) ? num.doubleValue() : (v == null ? "" : v.toString());
                sheet.getRange(r + 1, c).setValue(cell);
            }
        }
        SpreadSheet spread = new SpreadSheet();
        spread.appendSheet(sheet);
        spread.save(file);
    }

    private static void writeCsv(File file, List<String> headers, List<List<Object>> rows) throws Exception {
        try (Writer w = new BufferedWriter(Files.newBufferedWriter(file.toPath(), StandardCharsets.UTF_8))) {
            w.write('﻿'); // BOM so Excel opens UTF-8 correctly
            writeCsvRow(w, headers.toArray());
            for (List<Object> row : rows) writeCsvRow(w, row.toArray());
        }
    }

    private static void writeCsvRow(Writer w, Object[] cells) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(csv(cells[i]));
        }
        sb.append("\r\n");
        w.write(sb.toString());
    }

    private static String csv(Object v) {
        if (v == null) return "";
        String s = (v instanceof BigDecimal bd) ? bd.toPlainString() : v.toString();
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    private static String safeSheet(String name) {
        if (name == null || name.isBlank()) return "Sheet1";
        // Excel sheet names: max 31 chars, no : \ / ? * [ ]
        String s = name.replaceAll("[:\\\\/?*\\[\\]]", " ").trim();
        return s.length() > 31 ? s.substring(0, 31) : s;
    }

    private static void alert(Alert.AlertType type, String header, String msg) {
        Alert a = new Alert(type, msg, ButtonType.OK);
        a.setHeaderText(header);
        a.showAndWait();
    }
}
