package com.rajkotmarket.erp.model;

import java.time.LocalDateTime;

/** One entry of an order's audit trail (maps to {@code order_events}). */
public class OrderEvent {
    private final String actor;
    private final String event;
    private final String fromStatus;
    private final String toStatus;
    private final String note;
    private final LocalDateTime createdAt;

    public OrderEvent(String actor, String event, String fromStatus, String toStatus,
                      String note, LocalDateTime createdAt) {
        this.actor = actor;
        this.event = event;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.note = note;
        this.createdAt = createdAt;
    }

    public String getActor()           { return actor; }
    public String getEvent()           { return event; }
    public String getFromStatus()      { return fromStatus; }
    public String getToStatus()        { return toStatus; }
    public String getNote()            { return note; }
    public LocalDateTime getCreatedAt(){ return createdAt; }
}
