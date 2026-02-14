/**
 * mlx-audio — OpenClaw local TTS plugin
 *
 * Provides local text-to-speech via mlx-audio on Apple Silicon Macs.
 * Zero API key, zero cloud dependency.
 */
interface PluginApi {
    logger: {
        info: (msg: string) => void;
        error: (msg: string) => void;
        warn: (msg: string) => void;
    };
    config: {
        plugins?: {
            entries?: Record<string, {
                enabled?: boolean;
                config?: Record<string, unknown>;
            }>;
        };
    };
    registerService: (svc: {
        id: string;
        start: () => Promise<void> | void;
        stop: () => Promise<void> | void;
    }) => void;
    registerTool: (tool: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
    }) => void;
    registerCommand: (cmd: {
        name: string;
        description: string;
        acceptsArgs?: boolean;
        handler: (ctx: {
            args?: string;
        }) => {
            text: string;
        } | Promise<{
            text: string;
        }>;
    }) => void;
}
export default function register(api: PluginApi): void;
export {};
