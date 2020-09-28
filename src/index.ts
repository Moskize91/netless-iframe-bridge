import {InvisiblePlugin, Event, RoomState, InvisiblePluginContext, Displayer, Room, DisplayerState} from "white-web-sdk";
import { EventEmitter2 } from "eventemitter2";

export type IframeBridgeAttributes = {
    readonly url: string;
    readonly width: number;
    readonly height: number;
};

export type IframeSize = {
    readonly width: number;
    readonly height: number;
};

export type InsertOptions = {
    readonly player: any;
    readonly url: string;
    readonly width: number;
    readonly height: number;
    readonly readOnly: boolean;
    readonly isReplay: boolean;
    onLoad?: (event: globalThis.Event) => void;
};

export enum IframeEvents {
    Init = "Init",
    AttributesUpdate = "AttributesUpdate",
    SetAttributes = "SetAttributes",
    RegisterMagixEvent = "RegisterMagixEvent",
    RemoveMagixEvent = "RemoveMagixEvent",
    RemoveAllMagixEvent = "RemoveAllMagixEvent",
    RoomStateChanged = "RoomStateChanged",
    DispatchMagixEvent = "DispatchMagixEvent",
    ReciveMagixEvent = "ReciveMagixEvent",
    NextPage = "NextPage",
    PrevPage = "PrevPage",
}

export const WrapperDidMount = "WrapperDidMount";

export class IframeBridge extends InvisiblePlugin<IframeBridgeAttributes> {

    public static readonly kind: string = "IframeBridge";
    public static emitter: EventEmitter2 = new EventEmitter2();
    private static displayer: Displayer;

    public iframe: HTMLIFrameElement | null = null;
    private readonly magixEventMap: Map<string, (event: Event) => void> = new Map();
    private readOnly: boolean;
    private isReplay: boolean;
    private cssList: string[];

    public constructor(context: InvisiblePluginContext) {
        super(context);
        IframeBridge.displayer = context.displayer;
    }

    public static onCreate(plugin: IframeBridge): void {
        const attributes = plugin.attributes;
        if (attributes.url && attributes.height && attributes.width) {
            this.insert({ ...attributes, isReplay: false, readOnly: true, player: IframeBridge.displayer });
        }
    }

    public onAttributesUpdate(attributes: IframeBridgeAttributes): void {
        this.postMessage({ kind: IframeEvents.AttributesUpdate, payload: attributes });
    }

    public onDestroy(): void {
        window.removeEventListener("message", this.messageListener);
        this.magixEventMap.forEach((listener, event) => {
            this.displayer.removeMagixEventListener(event, listener);
        });
        this.magixEventMap.clear();
        if (this.iframe) {
            this.iframe.parentNode?.removeChild(this.iframe);
        }
    }

    public static async insert(options: InsertOptions): Promise<IframeBridge> {
        let instance = (options.player as any).getInvisiblePlugin(IframeBridge.kind);
        if (!instance) {
            const initAttributes: IframeBridgeAttributes = {
                url: options.url,
                width: options.width,
                height: options.height,
            };
            instance = await (options.player as any).createInvisiblePlugin(IframeBridge, initAttributes);
        }
        instance.isReplay = options.isReplay;
        instance.readOnly = options.readOnly;
        const wrapperDidMountListener = () => {
            instance.getIframe();
            instance.listenIframe(options);
            instance.fllowCamera();
        };
        if (instance.getIframe()) {
            wrapperDidMountListener();
        } else {
            this.emitter.once(WrapperDidMount, wrapperDidMountListener);
        }
        return instance;
    }

    public setAttributes(payload: any): void {
        this.ensureNotReadOnly();
        super.setAttributes(payload);
    }

    public setReadOnly(readOnly: boolean): void {
        this.readOnly = readOnly;
    }

    private getIframe(): HTMLIFrameElement {
        const iframe = document.getElementById(IframeBridge.kind) as HTMLIFrameElement;
        this.iframe = iframe;
        return iframe;
    }

    public setIframeSize(params: IframeSize): void {
        if (this.iframe) {
            this.iframe.width = `${params.width}px`;
            this.iframe.height = `${params.height}px`;
            this.setAttributes({ width: params.width, height: params.height });
        }
    }

    private listenIframe(options: InsertOptions): void {
        const iframe = document.getElementById(IframeBridge.kind) as HTMLIFrameElement;
        this.iframe = iframe;
        iframe.src = options.url;
        iframe.width = `${options.width}px`;
        iframe.height = `${options.height}px`;
        window.addEventListener("message", this.messageListener.bind(this));
        iframe.addEventListener("load", (ev: globalThis.Event) => {
            this.postMessage({ kind: IframeEvents.Init, payload: {
                attributes: this.attributes,
                roomState: IframeBridge.displayer.state,
            } });
            if (options.onLoad) {
                options.onLoad(ev);
            }
        });
    }

    private fllowCamera(): void {
        this.computedStyle(this.displayer.state);
        this.updateStyle();
        const callbackName = this.isReplay ? "onReplayStateChanged" : "onRoomStateChanged";
        (this.displayer as any).callbacks.on(callbackName, (state: RoomState) => {
            this.postMessage({ kind: IframeEvents.RoomStateChanged, payload: state });
            if (state.cameraState) {
                this.computedStyle(this.displayer.state);
                this.updateStyle();
            }
            if (state.memberState) {
                this.computedZindex();
                this.updateStyle();
            }
        });
    }

    private computedStyle(state: DisplayerState): void {
        const cameraState = state.cameraState;
        if (this.iframe) {
            const { width, height } = this.getIframeSize(this.iframe);
            const position = "position: absolute;";
            const borderWidth = "border-width: 0px;";
            const transformOriginX = `${(cameraState.width / 2)}px`;
            const transformOriginY = `${(cameraState.height / 2)}px`;
            const left = `left: ${(cameraState.width - width) / 2}px;`;
            const top = `top: ${(cameraState.height - height) / 2}px;`;
            const transformOrigin = `transform-origin: ${transformOriginX} ${transformOriginY};`;
            const x =  - ((cameraState.centerX) * cameraState.scale);
            const y = - ((cameraState.centerY) * cameraState.scale);
            const transform = `transform: translate(${x}px,${y}px) scale(${cameraState.scale}, ${cameraState.scale});`;
            const cssList = [position, borderWidth, top, left, transformOrigin, transform];
            this.cssList = cssList;
            this.computedZindex();
        }
    }

    private computedZindex(): void {
        const zIndexString = "z-index: -1;";
        const index = this.cssList.findIndex(css => css === zIndexString);
        if (index !== undefined) {
            this.cssList.splice(index, 1);
        }
        if (!this.isSelector()) {
            this.cssList.push(zIndexString);
        }
    }

    private updateStyle(): void {
        if (this.iframe) {
            this.iframe.style.cssText = this.cssList.join(" ");
        }
    }

    private messageListener(event: MessageEvent): void {
        if (event.origin !== this.iframeOrigin) {
            console.warn(`message origin: ${event.origin} not current iframe origin`);
            return;
        }
        const data = event.data;
        switch (data.kind) {
            case IframeEvents.SetAttributes: {
                this.handleSetAttributes(data);
                break;
            }
            case IframeEvents.RegisterMagixEvent: {
                this.handleRegisterMagixEvent(data);
                break;
            }
            case IframeEvents.RemoveMagixEvent: {
                this.handleRemoveMagixEvent(data);
                break;
            }
            case IframeEvents.DispatchMagixEvent: {
                this.handleDispatchMagixEvent(data);
                break;
            }
            case IframeEvents.RemoveAllMagixEvent: {
                this.handleRemoveAllMagixEvent();
                break;
            }
            case IframeEvents.NextPage: {
                this.handleNextPage();
                break;
            }
            case IframeEvents.PrevPage: {
                this.handlePrevPage();
                break;
            }
            default: {
                console.warn(`${data.kind} not allow event.`);
            }
        }
    }

    private handleDispatchMagixEvent(data: any): void {
        const eventPayload = data.payload;
        this.dispatchMagixEvent(eventPayload.event, eventPayload.payload);
    }

    private handleSetAttributes(data: any): void {
        this.setAttributes(data.payload);
    }

    private handleRegisterMagixEvent(data: any): void {
        const eventName = data.payload as string;
        const listener = (event: Event) => {
            if (event.authorId === this.displayer.observerId) {
                return;
            }
            this.postMessage({ kind: IframeEvents.ReciveMagixEvent, payload: event });
        };
        this.magixEventMap.set(eventName, listener);
        this.displayer.addMagixEventListener(eventName, listener);
    }

    private handleRemoveMagixEvent(data: any): void {
        const eventName = data.payload as string;
        const listener = this.magixEventMap.get(eventName);
        this.displayer.removeMagixEventListener(eventName, listener);
    }

    private handleNextPage(): void {
        this.ensureNotReadOnly();
        const nextPageNum = this.currentPage + 1;
        if (nextPageNum > this.totalPage) {
            return;
        }
        (this.displayer as any).setSceneIndex(nextPageNum - 1);
        this.dispatchMagixEvent(IframeEvents.NextPage, {});
    }

    private handlePrevPage(): void {
        this.ensureNotReadOnly();
        const prevPageNum = this.currentPage - 1;
        if (prevPageNum < 0) {
            return;
        }
        (this.displayer as any).setSceneIndex(prevPageNum - 1);
        this.dispatchMagixEvent(IframeEvents.PrevPage, {});
    }

    private handleRemoveAllMagixEvent(): void {
        this.magixEventMap.forEach((listener, event) => {
            this.displayer.removeMagixEventListener(event, listener);
        });
        this.magixEventMap.clear();
    }

    private postMessage(message: any): void {
        if (this.iframe) {
            this.iframe.contentWindow?.postMessage(message, "*");
        }
    }

    private dispatchMagixEvent(event: string, payload: any): void {
        this.ensureNotReadOnly();
        (this.displayer as any).dispatchMagixEvent(event, payload);
    }

    private get currentIndex(): number {
        return this.displayer.state.sceneState.index;
    }

    private get currentPage(): number {
        return this.currentIndex + 1;
    }

    private get totalPage(): number {
        return this.displayer.state.sceneState.scenes.length;
    }

    private ensureNotReadOnly(): void {
        if (this.readOnly) {
            throw new Error("readOnly mode cannot invoke this method");
        }
    }

    private isSelector(): boolean {
        if (this.readOnly) {
            return false;
        }
        return (this.displayer as Room).state.memberState.currentApplianceName === "selector";
    }

    private getIframeSize(iframe: HTMLIFrameElement): IframeSize {
        const width = iframe.getAttribute("width") || "0";
        const height = iframe.getAttribute("height") || "0";
        return { width: parseInt(width), height: parseInt(height) };
    }

    private get iframeOrigin (): string {
        const url = new URL(this.iframe!.src);
        return url.origin;
    }
}

export * from "./iframeWrapper";
