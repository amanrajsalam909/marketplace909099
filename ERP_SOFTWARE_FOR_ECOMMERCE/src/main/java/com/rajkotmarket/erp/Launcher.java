package com.rajkotmarket.erp;

/**
 * Plain (non-JavaFX) entry point used by the shaded fat-jar.
 * A class that does NOT extend javafx.application.Application is required as the
 * jar main-class so the JavaFX runtime bootstraps correctly from the classpath.
 */
public final class Launcher {
    public static void main(String[] args) {
        App.main(args);
    }
}
