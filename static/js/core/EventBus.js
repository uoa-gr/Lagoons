/**
 * EventBus - Centralized event management for loose coupling between modules
 */

class EventBus {
    constructor() {
        this.events = new Map();
        this.debug = false;
    }

    on(eventName, handler) {
        if (!eventName || typeof handler !== 'function') {
            console.error('EventBus.on: Invalid arguments', { eventName, handler });
            return () => {};
        }

        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }

        this.events.get(eventName).push(handler);

        if (this.debug || window.DEBUG_MODE) {
            console.log(`📡 EventBus: Registered listener for "${eventName}"`, handler.name || 'anonymous');
        }

        return () => this.off(eventName, handler);
    }

    off(eventName, handler) {
        if (!this.events.has(eventName)) return;

        const handlers = this.events.get(eventName);
        const index = handlers.indexOf(handler);

        if (index !== -1) {
            handlers.splice(index, 1);
            if (this.debug || window.DEBUG_MODE) {
                console.log(`📡 EventBus: Removed listener for "${eventName}"`);
            }
        }

        if (handlers.length === 0) this.events.delete(eventName);
    }

    once(eventName, handler) {
        const onceHandler = (payload) => {
            handler(payload);
            this.off(eventName, onceHandler);
        };
        return this.on(eventName, onceHandler);
    }

    emit(eventName, payload) {
        if (!this.events.has(eventName)) {
            if (this.debug || window.DEBUG_MODE) {
                console.log(`📡 EventBus: No listeners for "${eventName}"`);
            }
            return;
        }

        const handlers = this.events.get(eventName);

        if (this.debug || window.DEBUG_MODE) {
            console.log(`📡 EventBus: Emitting "${eventName}"`, { listeners: handlers.length, payload });
        }

        handlers.slice().forEach(handler => {
            try {
                handler(payload);
            } catch (error) {
                console.error(`EventBus: Error in handler for "${eventName}"`, error);
            }
        });
    }

    clear(eventName) {
        if (eventName) {
            this.events.delete(eventName);
        } else {
            this.events.clear();
        }
    }

    listenerCount(eventName) {
        return this.events.has(eventName) ? this.events.get(eventName).length : 0;
    }

    eventNames() {
        return Array.from(this.events.keys());
    }

    enableDebug()  { this.debug = true; }
    disableDebug() { this.debug = false; }
}

export default EventBus;
