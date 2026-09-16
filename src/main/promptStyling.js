import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { _log, _logError } from './mainUtils.js';
import { getChromeAlpha } from './colorUtils.js';

export class PromptStyling {
    constructor(extension) {
        this._extension = extension;
        this.cursorBlinkTimeoutId = null;
        this.lastWellH = undefined;
        this.lastYCenterFraction = undefined;
    }

    findPromptEntry(actor) {
        if (!actor)
            return null;

        if (actor.has_style_class_name?.('login-dialog-prompt-entry')) {
            return actor;
        }

        if (!actor.get_children)
            return null;

        for (const child of actor.get_children()) {
            const match = this.findPromptEntry(child);
            if (match)
                return match;
        }

        return null;
    }

    startCursorBlink() {
        this.stopCursorBlink();

        const dialog = this._extension._dialog;
        if (!dialog) return;

        const authPrompt = dialog._authPrompt ?? dialog._promptBox?._authPrompt;
        const entry = this.findPromptEntry(authPrompt);
        if (entry && entry.clutter_text) {
            entry.clutter_text.cursor_blink = (this._extension._cursorBlink !== false);
            entry.clutter_text.cursor_visible = true;
        }

        if (this._extension._cursorBlink === false)
            return;

        let visible = true;
        this.cursorBlinkTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            const currentDialog = this._extension._dialog;
            if (!currentDialog || !this._extension._promptActive) {
                this.cursorBlinkTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            }

            const currentAuthPrompt = currentDialog._authPrompt ?? currentDialog._promptBox?._authPrompt;
            if (!currentAuthPrompt) {
                return GLib.SOURCE_CONTINUE;
            }

            const currentEntry = this.findPromptEntry(currentAuthPrompt);
            if (!currentEntry || !currentEntry.clutter_text) {
                return GLib.SOURCE_CONTINUE;
            }

            if (!currentEntry.clutter_text.has_key_focus()) {
                currentEntry.clutter_text.cursor_visible = false;
                return GLib.SOURCE_CONTINUE;
            }

            visible = !visible;
            currentEntry.clutter_text.cursor_visible = visible;
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopCursorBlink() {
        if (this.cursorBlinkTimeoutId) {
            GLib.source_remove(this.cursorBlinkTimeoutId);
            this.cursorBlinkTimeoutId = null;
        }
    }

    applyPromptEntryBackground(entry, color) {
        if (!entry)
            return;

        if (!color) {
            if (entry._wackOriginalStyle !== undefined) {
                entry.set_style(entry._wackOriginalStyle);
                delete entry._wackOriginalStyle;
            } else {
                entry.set_style(null);
            }
            delete entry._wackColor;
            return;
        }

        entry._wackColor = color;
        if (entry._wackOriginalStyle === undefined)
            entry._wackOriginalStyle = entry.get_style() ?? '';

        const vibrancyMode = color.vibrancyMode ?? (this._extension?._settings?.get_string('prompt-vibrancy') ?? 'tonal');

        let shadowStyle = '';
        if (color.shadowAlpha !== undefined) {
            shadowStyle = ` box-shadow: 0 2px 24px rgba(0, 0, 0, ${color.shadowAlpha.toFixed(3)}) !important;`;
        }

        let bgStyle;
        const isSolid = (vibrancyMode === 'tonal' || vibrancyMode === 'less');
        if (!isSolid && color.imagePath) {
            const imageUri = color.imagePath.startsWith('file://') ? color.imagePath : `file://${color.imagePath}`;
            bgStyle = ` background-color: transparent !important; background-gradient-direction: none !important; background-image: url("${imageUri}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; border: none !important;`;
        } else if (color.start && color.end && color.direction && color.direction !== 'none') {
            const startStr = `rgb(${color.start.r}, ${color.start.g}, ${color.start.b})`;
            const endStr = `rgb(${color.end.r}, ${color.end.g}, ${color.end.b})`;
            bgStyle = ` background-color: transparent !important; background-gradient-direction: ${color.direction} !important; background-gradient-start: ${startStr} !important; background-gradient-end: ${endStr} !important; background-image: none !important; border: none !important;`;
        } else {
            bgStyle = ` background-image: none !important; background-gradient-direction: none !important; background-color: rgb(${color.r}, ${color.g}, ${color.b}) !important; border: none !important;`;
        }

        entry.set_style(`${entry._wackOriginalStyle}${bgStyle}${shadowStyle}`);
    }

    _setupChromeButton(button, color, buttonType = 'generic') {
        if (!button)
            return;

        if (!color) {
            button.disconnectObject(this);
            if (button._wackOriginalStyle !== undefined) {
                button.set_style(button._wackOriginalStyle);
                delete button._wackOriginalStyle;
            } else {
                button.set_style(null);
            }
            delete button._wackColor;
            delete button._wackPressed;
            delete button._wackButtonType;
            delete button._wackAppliedR;
            delete button._wackAppliedG;
            delete button._wackAppliedB;
            return;
        }

        button._wackColor = color;
        button._wackButtonType = buttonType;

        if (button._wackOriginalStyle === undefined) {
            button._wackOriginalStyle = button.get_style() ?? '';

            button.connectObject(
                'notify::hover', () => this._updateChromeButtonStyle(button, button._wackButtonType),
                'notify::has-focus', () => this._updateChromeButtonStyle(button, button._wackButtonType),
                'button-press-event', () => {
                    button._wackPressed = true;
                    this._updateChromeButtonStyle(button, button._wackButtonType);
                    return Clutter.EVENT_PROPAGATE;
                },
                'button-release-event', () => {
                    button._wackPressed = false;
                    this._updateChromeButtonStyle(button, button._wackButtonType);
                    return Clutter.EVENT_PROPAGATE;
                },
                this
            );
        }

        this._updateChromeButtonStyle(button, buttonType);
    }

    _updateChromeButtonStyle(button, buttonType = 'generic') {
        const color = button._wackColor;
        if (!color)
            return;

        if (!button.hover)
            button._wackPressed = false;

        const isHovered = button.hover && !button._wackPressed;
        const isPressed = button._wackPressed;
        const isFocused = button.has_focus;

        const colorObj = buttonType === 'cancel'
            ? (color.cancelColor ?? (color.r !== undefined ? color : null))
            : buttonType === 'a11y'
                ? (color.a11yColor ?? (color.r !== undefined ? color : null))
                : buttonType === 'session'
                    ? (color.sessionColor ?? (color.r !== undefined ? color : null))
                    : color;

        if (!colorObj || colorObj.r == null || colorObj.g == null || colorObj.b == null)
            return;

        const vibrancyMode = color.vibrancyMode ?? (this._extension?._settings?.get_string('prompt-vibrancy') ?? 'tonal');
        const isSolid = (vibrancyMode === 'tonal' || vibrancyMode === 'less');

        const visualState = colorObj.visualState ?? color.visualState ?? colorObj;
        const hoverAlpha = getChromeAlpha(visualState, 'hover');
        const activeAlpha = getChromeAlpha(visualState, 'active');
        const focusAlpha = getChromeAlpha(visualState, 'focus');

        let bgStyle;
        let imgPath = null;

        if (!isSolid && buttonType === 'cancel') {
            imgPath = color.cancelImagePath ?? color.imagePath;
        }

        if (imgPath) {
            const imageUri = imgPath.startsWith('file://') ? imgPath : `file://${imgPath}`;
            let overlayStyle = '';
            if (isFocused) {
                overlayStyle += ` border: 1px solid rgba(255, 255, 255, ${(focusAlpha * 2.5).toFixed(3)}) !important;`;
            }
            if (isHovered) {
                overlayStyle += ` color: #ffffff !important;`;
            }
            bgStyle = ` background-color: transparent !important; background-gradient-direction: none !important; background-image: url("${imageUri}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important;${overlayStyle}`;
        } else {
            let curR = colorObj.r;
            let curG = colorObj.g;
            let curB = colorObj.b;

            if (isPressed) {
                const invA = 1 - activeAlpha;
                curR = Math.min(255, Math.max(0, Math.round(curR * invA + 255 * activeAlpha)));
                curG = Math.min(255, Math.max(0, Math.round(curG * invA + 255 * activeAlpha)));
                curB = Math.min(255, Math.max(0, Math.round(curB * invA + 255 * activeAlpha)));
            } else if (isHovered) {
                const invA = 1 - hoverAlpha;
                curR = Math.min(255, Math.max(0, Math.round(curR * invA + 255 * hoverAlpha)));
                curG = Math.min(255, Math.max(0, Math.round(curG * invA + 255 * hoverAlpha)));
                curB = Math.min(255, Math.max(0, Math.round(curB * invA + 255 * hoverAlpha)));
            }

            let overlayStyle = '';
            if (isHovered) {
                overlayStyle += ` color: #ffffff !important;`;
            }
            if (isFocused) {
                overlayStyle += ` border: 1px solid rgba(255, 255, 255, ${(focusAlpha * 2.5).toFixed(3)}) !important;`;
            }
            bgStyle = ` background-image: none !important; background-gradient-direction: none !important; background-color: rgb(${curR}, ${curG}, ${curB}) !important;${overlayStyle}`;
        }

        button.set_style(`${button._wackOriginalStyle}${bgStyle}`);
    }

    applyCancelButtonBackground(button, color) {
        this._setupChromeButton(button, color, 'cancel');
    }

    updateCancelButtonStyle(button) {
        this._updateChromeButtonStyle(button, 'cancel');
    }

    applyA11yButtonBackground(button, color) {
        this._setupChromeButton(button, color, 'a11y');
    }

    applySessionButtonBackground(button, color) {
        this._setupChromeButton(button, color, 'session');
    }

    clearCupertinoPromptBackground() {
        const dialog = this._extension._dialog;
        const authPrompt = dialog?._authPrompt ?? dialog?._promptBox?._authPrompt;
        const entry = this.findPromptEntry(authPrompt);
        if (entry)
            this.applyPromptEntryBackground(entry, null);

        const cancelButton = authPrompt?.cancelButton;
        if (cancelButton)
            this.applyCancelButtonBackground(cancelButton, null);
    }

    clearBottomButtonsBackground() {
        const dialog = this._extension._dialog;
        const a11yButton = dialog?._a11yMenuButton
            ?? dialog?._bottomButtonGroup?._a11yMenuButton
            ?? dialog?._bottomButtonGroup?.get_children?.().find?.(c => c.has_style_class_name?.('a11y-button'));
        if (a11yButton)
            this.applyA11yButtonBackground(a11yButton, null);

        const sessionButton = dialog?._authMenuButton
            ?? dialog?._sessionMenuButton?._button
            ?? dialog?._sessionMenuButton?.get_child?.()
            ?? dialog?._sessionMenuButton
            ?? dialog?._bottomButtonGroup?._authMenuButton
            ?? dialog?._bottomButtonGroup?._sessionMenuButton?._button
            ?? dialog?._bottomButtonGroup?._sessionMenuButton
            ?? dialog?._bottomButtonGroup?.get_children?.().find?.(c => c.has_style_class_name?.('login-dialog-auth-menu-button') || c.has_style_class_name?.('login-dialog-session-list-button'));
        if (sessionButton)
            this.applySessionButtonBackground(sessionButton, null);
    }

    onAuthPromptAllocation() {
        _log(`[WACK/Extension] onAuthPromptAllocation() called. promptActive=${this._extension._promptActive}`);
        if (!this._extension._promptActor || !this._extension._promptActor.has_style_class_name('wack-cupertino-prompt'))
            return;

        let wellH = 0;
        const restPrompt = this._extension._cupertinoPromptManager?.restPrompt ?? this._extension._cupertinoRestPrompt;
        if (restPrompt?._userWell) {
            const [, , , hSize] = restPrompt._userWell.get_preferred_size();
            wellH = hSize > 0 ? hSize : 0;
        }

        let yCenterFraction = null;
        let promptBounds = null;
        const dialog = this._extension._dialog;
        const authPrompt = dialog?._authPrompt ?? dialog?._promptBox?._authPrompt;
        const entry = this.findPromptEntry(authPrompt) ?? restPrompt?._hintBox;
        if (entry) {
            const [xTrans, yTrans] = entry.get_transformed_position();
            const wTrans = entry.get_width() || 0;
            const hTrans = entry.get_height() || 0;
            const monitor = Main.layoutManager?.primaryMonitor;
            const monitorX = monitor ? monitor.x : 0;
            const monitorY = monitor ? monitor.y : 0;
            const monitorHeight = monitor ? monitor.height : 1080;
            const monitorWidth = monitor ? monitor.width : 1920;
            if (yTrans > 0 && monitorHeight > 0)
                yCenterFraction = (yTrans + hTrans / 2 - monitorY) / monitorHeight;
            if (wTrans > 0 && hTrans > 0 && monitorWidth > 0 && monitorHeight > 0 && xTrans >= monitorX && yTrans >= monitorY) {
                promptBounds = {
                    x1: Math.max(0, Math.min(1, (xTrans - monitorX) / monitorWidth)),
                    x2: Math.max(0, Math.min(1, (xTrans + wTrans - monitorX) / monitorWidth)),
                    y1: Math.max(0, Math.min(1, (yTrans - monitorY) / monitorHeight)),
                    y2: Math.max(0, Math.min(1, (yTrans + hTrans - monitorY) / monitorHeight)),
                };
            }
        }

        const wellChanged = wellH !== this.lastWellH;
        const yCenterChanged = yCenterFraction !== null &&
            (this.lastYCenterFraction === undefined || Math.abs(yCenterFraction - this.lastYCenterFraction) > 0.001);
        const boundsChanged = promptBounds && (!this.lastPromptBounds ||
            Math.abs(promptBounds.x1 - this.lastPromptBounds.x1) > 0.002 ||
            Math.abs(promptBounds.x2 - this.lastPromptBounds.x2) > 0.002 ||
            Math.abs(promptBounds.y1 - this.lastPromptBounds.y1) > 0.002);

        if (wellChanged || yCenterChanged || boundsChanged) {
            if (wellChanged) this.lastWellH = wellH;
            if (yCenterChanged) this.lastYCenterFraction = yCenterFraction;
            if (boundsChanged) this.lastPromptBounds = promptBounds;
            this._extension._updateClockAlphaAndPromptColor?.().catch(e => {
                _logError('[WACK/Extension] Failed to update prompt background in allocation: ' + e);
            });
        }
    }

    teardown() {
        this.stopCursorBlink();
        this.clearCupertinoPromptBackground();
        this.clearBottomButtonsBackground();
    }
}
