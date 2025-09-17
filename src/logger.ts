import * as vscode from 'vscode';

export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.Info;
    private context: vscode.ExtensionContext | undefined;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Bot Boss Debug');
        this.setupLogLevel();
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.context = context;
        context.subscriptions.push(this.outputChannel);
        
        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('bot-boss.debug')) {
                    this.setupLogLevel();
                }
            })
        );

        this.info('Logger', 'Logger initialized');
    }

    private setupLogLevel() {
        const config = vscode.workspace.getConfiguration('bot-boss');
        const debugEnabled = config.get<boolean>('debug.enabled', false);
        const logLevelSetting = config.get<string>('debug.logLevel', 'info');
        
        // Also check environment variable
        const envDebug = process.env.BOT_BOSS_DEBUG === '1' || process.env.BOT_BOSS_DEBUG === 'true';
        
        if (debugEnabled || envDebug) {
            switch (logLevelSetting.toLowerCase()) {
                case 'debug':
                    this.logLevel = LogLevel.Debug;
                    break;
                case 'info':
                    this.logLevel = LogLevel.Info;
                    break;
                case 'warn':
                    this.logLevel = LogLevel.Warn;
                    break;
                case 'error':
                    this.logLevel = LogLevel.Error;
                    break;
                default:
                    this.logLevel = LogLevel.Debug; // Default to debug when enabled
            }
        } else {
            this.logLevel = LogLevel.Warn; // Only show warnings and errors by default
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    private formatMessage(level: string, component: string, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        let formatted = `[${timestamp}] [${level}] [${component}] ${message}`;
        
        if (data !== undefined) {
            if (typeof data === 'object') {
                try {
                    formatted += '\n' + JSON.stringify(data, null, 2);
                } catch (error) {
                    formatted += '\n' + String(data);
                }
            } else {
                formatted += ' ' + String(data);
            }
        }
        
        return formatted;
    }

    private log(level: LogLevel, levelName: string, component: string, message: string, data?: any) {
        if (!this.shouldLog(level)) {
            return;
        }

        const formatted = this.formatMessage(levelName, component, message, data);
        
        // Always log to output channel
        this.outputChannel.appendLine(formatted);
        
        // Also log to console for development
        if (level >= LogLevel.Error) {
            console.error(formatted);
        } else if (level >= LogLevel.Warn) {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    }

    public debug(component: string, message: string, data?: any) {
        this.log(LogLevel.Debug, 'DEBUG', component, message, data);
    }

    public info(component: string, message: string, data?: any) {
        this.log(LogLevel.Info, 'INFO', component, message, data);
    }

    public warn(component: string, message: string, data?: any) {
        this.log(LogLevel.Warn, 'WARN', component, message, data);
    }

    public error(component: string, message: string, data?: any) {
        this.log(LogLevel.Error, 'ERROR', component, message, data);
    }

    public show() {
        this.outputChannel.show();
    }

    public clear() {
        this.outputChannel.clear();
    }

    public dispose() {
        this.outputChannel.dispose();
    }

    // Convenience methods for common logging patterns
    public logMethodEntry(component: string, methodName: string, args?: any) {
        this.debug(component, `→ ${methodName}`, args);
    }

    public logMethodExit(component: string, methodName: string, result?: any) {
        this.debug(component, `← ${methodName}`, result);
    }

    public logError(component: string, methodName: string, error: Error | unknown) {
        const errorData = error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
        } : error;
        
        this.error(component, `Error in ${methodName}`, errorData);
    }

    public logPerformance(component: string, operation: string, startTime: number) {
        const duration = Date.now() - startTime;
        this.debug(component, `Performance: ${operation} took ${duration}ms`);
    }
}

// Create a global logger instance
export const logger = Logger.getInstance();

// Decorator for logging method calls
export function logMethodCalls(component: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const startTime = Date.now();
            logger.logMethodEntry(component, propertyKey, args.length > 0 ? args : undefined);
            
            try {
                const result = await originalMethod.apply(this, args);
                logger.logMethodExit(component, propertyKey, result);
                logger.logPerformance(component, propertyKey, startTime);
                return result;
            } catch (error) {
                logger.logError(component, propertyKey, error);
                throw error;
            }
        };
        
        return descriptor;
    };
}