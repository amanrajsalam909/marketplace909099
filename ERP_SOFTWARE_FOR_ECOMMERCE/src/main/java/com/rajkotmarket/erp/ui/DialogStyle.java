package com.rajkotmarket.erp.ui;

import javafx.scene.Node;
import javafx.scene.control.Dialog;

/**
 * Applies the app stylesheet (and a sensible owner window) to a programmatically
 * built {@link Dialog} so it matches the rest of the UI instead of falling back
 * to default JavaFX styling.
 */
final class DialogStyle {

    private DialogStyle() { }

    /** @param anchor any node already in the scene, used to find the owner window. */
    static void apply(Dialog<?> dlg, Node anchor) {
        var css = DialogStyle.class.getResource("/css/app.css");
        if (css != null) {
            dlg.getDialogPane().getStylesheets().add(css.toExternalForm());
        }
        dlg.getDialogPane().getStyleClass().add("app-dialog");
        if (anchor != null && anchor.getScene() != null && anchor.getScene().getWindow() != null) {
            dlg.initOwner(anchor.getScene().getWindow());
        }
    }
}
