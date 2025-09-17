import * as vscode from 'vscode';
import { logger } from './logger';
import { CopilotInfo, VSCodeInstanceService } from './vscodeInstanceService';

/**
 * Chat status information for GitHub Copilot Chat
 */
export interface CopilotChatInfo {
    isActive: boolean;
    state?: string;
    isResponding?: boolean;
    hasParticipants?: boolean;
    lastChatActivity?: string;
}

/**
 * Extended CopilotInfo with chat status
 */
export interface ExtendedCopilotInfo extends CopilotInfo {
    chat?: CopilotChatInfo;
}

/**
 * Lightweight polling service focused ONLY on the current window's GitHub Copilot status.
 * Does NOT call the public GitHub Status API – instead it inspects the locally installed
 * Copilot extension exports & commands so the user sees the REAL runtime state of Copilot
 * in this VS Code instance.
 * 
 * Also monitors GitHub Copilot Chat status using the VS Code Chat API when available.
 */
export class CopilotStatusService {
    private static instance: CopilotStatusService;
    private readonly instanceService = VSCodeInstanceService.getInstance();
    private readonly emitter = new vscode.EventEmitter<CopilotInfo>();
    private pollingTimer: NodeJS.Timeout | undefined;
    private lastStatus: CopilotInfo | undefined;
    private intervalMs: number;
    private disposed = false;
    private context: vscode.ExtensionContext | undefined;
    // Chat state monitoring
    private chatStateListener: vscode.Disposable | undefined;
    private extensionChangeListener: vscode.Disposable | undefined;
    private lastChatState: any | undefined; // Using 'any' since vscode.ChatState might not be available in all versions
    // Marked public for prototype augmentation access
    public history: CopilotHistoryEntry[] = [];
    public maxEntries = 50;

    public static readonly HISTORY_KEY = 'botBoss.copilot.history';

    /**
     * IMPORTANT: The status strings map to severity for aggregated display.
     * Higher number = worse state.
     */
    public static severity(status: CopilotInfo['status']): number {
        switch (status) {
            case 'Failed':
            case 'Error': return 5;
            case 'Unauthorized':
            case 'SigninRequired':
            case 'RateLimited':
            case 'Waiting for Approval': return 4;
            case 'Initializing': return 3;
            case 'Generating': return 2;
            case 'Disabled': return 1;
            case 'Done':
            case 'Idle':
            case 'Running': return 0;
            default: return 0; // Unknown treated neutral
        }
    }

    public static getInstance(intervalMs: number = 7000): CopilotStatusService {
        if (!CopilotStatusService.instance) {
            CopilotStatusService.instance = new CopilotStatusService(intervalMs);
        }
        return CopilotStatusService.instance;
    }

    private constructor(intervalMs: number) {
        this.intervalMs = intervalMs;
    }

    public get onStatusChange(): vscode.Event<CopilotInfo> {
        return this.emitter.event;
    }

    /** Current cached status (may be undefined before first poll) */
    public getCurrentStatus(): CopilotInfo | undefined {
        return this.lastStatus;
    }

    /** Get current chat status specifically */
    public getCurrentChatStatus(): CopilotChatInfo | undefined {
        const currentStatus = this.getCurrentStatus() as any;
        return currentStatus?.chat;
    }

    /** Debug method to explore Copilot extension exports */
    public debugCopilotExtensions(): void {
        logger.info('CopilotStatusService', '=== Debugging Copilot Extensions ===');
        console.log('[BotBoss] === Debugging Copilot Extensions ===');
        
        const copilotExtension = vscode.extensions.getExtension('github.copilot');
        const copilotChatExtension = vscode.extensions.getExtension('github.copilot-chat');
        
        logger.debug('CopilotStatusService', 'Extension availability', {
            copilotInstalled: !!copilotExtension,
            copilotChatInstalled: !!copilotChatExtension
        });
        
        console.log('Copilot extension installed:', !!copilotExtension);
        console.log('Copilot Chat extension installed:', !!copilotChatExtension);
        
        if (copilotExtension) {
            const isActive = copilotExtension.isActive;
            logger.debug('CopilotStatusService', 'Copilot extension details', {
                active: isActive,
                version: copilotExtension.packageJSON?.version,
                exportsAvailable: !!copilotExtension.exports
            });
            
            console.log('Copilot extension active:', isActive);
            if (isActive && copilotExtension.exports) {
                const exportKeys = Object.keys(copilotExtension.exports);
                logger.debug('CopilotStatusService', 'Copilot exports', {
                    keys: exportKeys,
                    keyCount: exportKeys.length
                });
                
                console.log('Copilot exports keys:', exportKeys);
                
                // Test the getAPI method specifically
                if (typeof copilotExtension.exports.getAPI === 'function') {
                    console.log('[BotBoss] Testing getAPI() method...');
                    try {
                        const api = copilotExtension.exports.getAPI();
                        console.log('[BotBoss] getAPI() returned:', api ? Object.keys(api) : 'null');
                        
                        if (api && api.chat) {
                            console.log('[BotBoss] Chat API found:', Object.keys(api.chat));
                        }
                        
                        // Test chat status detection using the new logic
                        const chatStatus = this.getChatStateInfo();
                        console.log('[BotBoss] Current chat status:', chatStatus);
                    } catch (apiError) {
                        console.log('[BotBoss] Error testing getAPI():', apiError);
                    }
                }
                
                // Try to log some values safely
                exportKeys.slice(0, 20).forEach(key => {
                    const value = copilotExtension.exports![key];
                    const type = typeof value;
                    const details = type === 'object' && value ? ` (${Object.keys(value).length} props)` : '';
                    logger.debug('CopilotStatusService', `Export: ${key}`, { type, details });
                    console.log(`  ${key}: ${type}${details}`);
                });
            }
        }
        
        if (copilotChatExtension) {
            console.log('Copilot Chat extension active:', copilotChatExtension.isActive);
            if (copilotChatExtension.isActive && copilotChatExtension.exports) {
                console.log('Copilot Chat exports keys:', Object.keys(copilotChatExtension.exports));
                
                // Test getAPI on chat extension too
                if (typeof copilotChatExtension.exports.getAPI === 'function') {
                    console.log('[BotBoss] Testing Copilot Chat getAPI() method...');
                    try {
                        const chatApi = copilotChatExtension.exports.getAPI();
                        console.log('[BotBoss] Chat getAPI() returned:', chatApi ? Object.keys(chatApi) : 'null');
                    } catch (chatApiError) {
                        console.log('[BotBoss] Error testing Chat getAPI():', chatApiError);
                    }
                }
                
                // Try to log some values safely
                Object.keys(copilotChatExtension.exports).slice(0, 20).forEach(key => {
                    const value = copilotChatExtension.exports![key];
                    const type = typeof value;
                    console.log(`  ${key}: ${type}${type === 'object' && value ? ` (${Object.keys(value).length} props)` : ''}`);
                });
            }
        }
        
        // Also check VS Code chat API
        const chatApi = (vscode as any).chat;
        if (chatApi) {
            console.log('VS Code Chat API available');
            console.log('Chat API keys:', Object.keys(chatApi));
        } else {
            console.log('VS Code Chat API not available');
        }
        
        console.log('[BotBoss] === End Debug ===');
    }

    /** Start background polling */
    public start(): void {
        if (this.pollingTimer) return; // already running
        
        // Set up extension change monitoring for Copilot
        this.setupExtensionChangeMonitoring();
        
        // Set up chat state monitoring
        this.setupChatStateMonitoring();
        
        // Perform immediate poll then schedule
        this.pollOnce();
        this.pollingTimer = setInterval(() => this.pollOnce(), this.intervalMs);
    }

    /** Stop background polling */
    public stop(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = undefined;
        }
        
        // Clean up chat state listener
        if (this.chatStateListener) {
            this.chatStateListener.dispose();
            this.chatStateListener = undefined;
        }
        
        // Clean up extension change listener
        if (this.extensionChangeListener) {
            this.extensionChangeListener.dispose();
            this.extensionChangeListener = undefined;
        }
    }

    /** Dispose resources */
    public async dispose(): Promise<void> {
        this.disposed = true;
        this.stop();
        this.emitter.dispose();
    }

    /** Initialize with extension context (loads persisted history, sets config listeners) */
    public initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadHistory();
        this.applyConfig();
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('bot-boss.copilot.history.maxEntries')) {
                    this.applyConfig();
                    this.trimHistory();
                }
                if (e.affectsConfiguration('bot-boss.copilot.pollIntervalMs')) {
                    this.applyConfig();
                }
            })
        );
    }

    /** Force an on-demand refresh */
    public async refresh(): Promise<CopilotInfo | undefined> {
        return this.pollOnce();
    }

    /**
     * Set up extension change monitoring for Copilot
     */
    private setupExtensionChangeMonitoring(): void {
        try {
            console.log('[BotBoss] Setting up extension change monitoring...');
            
            this.extensionChangeListener = vscode.extensions.onDidChange(() => {
                console.log('[BotBoss] Extensions changed, checking Copilot status...');
                
                // Trigger a status update when extensions change
                this.pollOnce().catch(err => {
                    console.error('[BotBoss] Error polling after extension change:', err);
                });
            });
            
            console.log('[BotBoss] Extension change monitoring setup complete');
        } catch (error) {
            console.error('[BotBoss] Error setting up extension change monitoring:', error);
        }
    }

    /**
     * Set up chat state monitoring using VS Code chat API
     */
    private setupChatStateMonitoring(): void {
        try {
            // Check if VS Code chat API is available
            if (typeof (vscode as any).chat !== 'undefined') {
                const chatApi = (vscode as any).chat;
                console.log('[BotBoss] Setting up chat state monitoring...');
                
                // Listen for chat state changes
                if (chatApi.onDidChangeState) {
                    this.chatStateListener = chatApi.onDidChangeState((event: any) => {
                        console.log('[BotBoss] Chat state changed:', event);
                        this.lastChatState = event.state || event;
                        
                        // Trigger a status update since chat state changed
                        this.pollOnce().catch(err => {
                            console.error('[BotBoss] Error polling after chat state change:', err);
                        });
                    });
                    console.log('[BotBoss] Chat state monitoring setup complete');
                } else {
                    console.log('[BotBoss] Chat API available but onDidChangeState not found');
                }

                // Also try to listen for chat participant events if available
                if (chatApi.onDidAddParticipant || chatApi.onDidRemoveParticipant) {
                    console.log('[BotBoss] Setting up chat participant monitoring...');
                    
                    if (chatApi.onDidAddParticipant) {
                        const addParticipantListener = chatApi.onDidAddParticipant((participant: any) => {
                            console.log('[BotBoss] Chat participant added:', participant);
                            this.pollOnce().catch(err => {
                                console.error('[BotBoss] Error polling after participant added:', err);
                            });
                        });
                        // Store the listener for cleanup
                        if (!this.chatStateListener) {
                            this.chatStateListener = addParticipantListener;
                        }
                    }
                    
                    if (chatApi.onDidRemoveParticipant) {
                        const removeParticipantListener = chatApi.onDidRemoveParticipant((participant: any) => {
                            console.log('[BotBoss] Chat participant removed:', participant);
                            this.pollOnce().catch(err => {
                                console.error('[BotBoss] Error polling after participant removed:', err);
                            });
                        });
                        // Store the listener for cleanup if no other listener exists
                        if (!this.chatStateListener) {
                            this.chatStateListener = removeParticipantListener;
                        }
                    }
                }
                
            } else {
                console.log('[BotBoss] VS Code chat API not available');
            }
        } catch (error) {
            console.error('[BotBoss] Error setting up chat state monitoring:', error);
        }
    }

    /**
     * Get current chat state information from Copilot extensions
     */
    private getChatStateInfo(): { isActive: boolean; state?: string; isResponding?: boolean } {
        try {
            // First, try to get info from Copilot Chat extension specifically
            const copilotChatExtension = vscode.extensions.getExtension('github.copilot-chat');
            const copilotExtension = vscode.extensions.getExtension('github.copilot');
            
            if (!copilotChatExtension && !copilotExtension) {
                return { isActive: false };
            }

            const primaryExtension = copilotChatExtension || copilotExtension;
            
            if (!primaryExtension?.isActive) {
                return { isActive: false };
            }

            console.log('[BotBoss] Checking Copilot Chat status from extensions...');
            
            // Try to get chat state from extension exports
            const exports = primaryExtension.exports;
            if (exports) {
                console.log('[BotBoss] Extension exports available, keys:', Object.keys(exports).slice(0, 10));
                
                let isResponding = false;
                let state = 'idle';
                let chatApi: any = null;
                
                // First, try to get the API using getAPI method (standard for Copilot)
                if (typeof exports.getAPI === 'function') {
                    try {
                        console.log('[BotBoss] Calling getAPI() to get Copilot API...');
                        chatApi = exports.getAPI();
                        console.log('[BotBoss] Got API object:', chatApi ? Object.keys(chatApi).slice(0, 10) : 'null');
                        
                        if (chatApi) {
                            // Check for chat-related status in the API
                            if (chatApi.chat) {
                                console.log('[BotBoss] Found chat object in API:', Object.keys(chatApi.chat).slice(0, 10));
                                
                                // Check chat status properties
                                const chat = chatApi.chat;
                                if (chat.isResponding || chat.responding || chat.isGenerating || chat.generating) {
                                    isResponding = true;
                                    state = 'responding';
                                    console.log('[BotBoss] Chat is actively responding');
                                } else if (chat.isActive || chat.active) {
                                    state = 'active';
                                    console.log('[BotBoss] Chat is active but not responding');
                                }
                                
                                // Check for session information
                                if (chat.sessions || chat.conversations) {
                                    const sessions = chat.sessions || chat.conversations;
                                    if (Array.isArray(sessions) && sessions.length > 0) {
                                        console.log(`[BotBoss] Found ${sessions.length} chat sessions`);
                                        const activeSessions = sessions.filter((s: any) => s.isActive || s.isResponding);
                                        if (activeSessions.length > 0) {
                                            isResponding = true;
                                            state = 'responding';
                                            console.log(`[BotBoss] Found ${activeSessions.length} active sessions`);
                                        }
                                    }
                                }
                                
                                // Try calling status methods on the chat API
                                const chatStatusMethods = ['getStatus', 'getChatStatus', 'getState'];
                                for (const method of chatStatusMethods) {
                                    if (typeof chat[method] === 'function') {
                                        try {
                                            const chatStatus = chat[method]();
                                            console.log(`[BotBoss] Chat.${method}():`, chatStatus);
                                            
                                            if (chatStatus && typeof chatStatus === 'object') {
                                                if (chatStatus.isResponding || chatStatus.isGenerating) {
                                                    isResponding = true;
                                                    state = 'responding';
                                                } else if (chatStatus.isActive) {
                                                    state = 'active';
                                                }
                                            } else if (typeof chatStatus === 'string') {
                                                state = chatStatus;
                                                if (chatStatus.includes('respond') || chatStatus.includes('generat')) {
                                                    isResponding = true;
                                                }
                                            }
                                        } catch (methodError) {
                                            console.log(`[BotBoss] Error calling chat.${method}:`, methodError);
                                        }
                                    }
                                }
                            }
                            
                            // Check for general status methods on the main API
                            const generalStatusMethods = ['getStatus', 'getChatStatus', 'getState', 'getChatState'];
                            for (const method of generalStatusMethods) {
                                if (typeof chatApi[method] === 'function') {
                                    try {
                                        const apiStatus = chatApi[method]();
                                        console.log(`[BotBoss] API.${method}():`, apiStatus);
                                        
                                        if (apiStatus && typeof apiStatus === 'object') {
                                            // Check for chat-specific status
                                            if (apiStatus.chat || apiStatus.chatStatus) {
                                                const chatStatus = apiStatus.chat || apiStatus.chatStatus;
                                                if (chatStatus.isResponding || chatStatus.isGenerating) {
                                                    isResponding = true;
                                                    state = 'responding';
                                                } else if (chatStatus.isActive) {
                                                    state = 'active';
                                                }
                                            }
                                            // Check for general status indicators
                                            if (apiStatus.isResponding || apiStatus.isGenerating) {
                                                isResponding = true;
                                                state = 'responding';
                                            } else if (apiStatus.isActive) {
                                                state = 'active';
                                            }
                                        }
                                    } catch (methodError) {
                                        console.log(`[BotBoss] Error calling API.${method}:`, methodError);
                                    }
                                }
                            }
                            
                            // Check for event emitters or listeners that might indicate activity
                            if (chatApi.onDidChangeState || chatApi.onChatStateChange) {
                                console.log('[BotBoss] Found chat state change listeners in API');
                                // The presence of these suggests chat functionality is active
                                if (state === 'idle') {
                                    state = 'available';
                                }
                            }
                        }
                    } catch (apiError) {
                        console.log('[BotBoss] Error calling getAPI():', apiError);
                    }
                }
                
                // Fallback: Check direct properties on exports (legacy approach)
                if (!chatApi) {
                    console.log('[BotBoss] Fallback: checking direct export properties...');
                    
                    // Check various possible chat state indicators
                    const chatIndicators = [
                        'isChatResponding', 'chatResponding', 'isGenerating', 'generating',
                        'isBusy', 'busy', 'isWorking', 'working', 'isActive', 'active'
                    ];
                    
                    for (const indicator of chatIndicators) {
                        if (exports[indicator] === true) {
                            isResponding = true;
                            state = 'responding';
                            console.log(`[BotBoss] Found chat activity indicator: ${indicator} = true`);
                            break;
                        }
                    }
                    
                    // Check for chat sessions or conversation data
                    const sessionProperties = [
                        'chatSessions', 'sessions', 'conversations', 'activeConversations',
                        'chatHistory', 'history', 'activeChats', 'chats'
                    ];
                    
                    for (const prop of sessionProperties) {
                        if (exports[prop]) {
                            console.log(`[BotBoss] Found session property: ${prop}`, typeof exports[prop]);
                            
                            // If it's an array, check if it has active items
                            if (Array.isArray(exports[prop]) && exports[prop].length > 0) {
                                console.log(`[BotBoss] Found ${exports[prop].length} chat sessions`);
                                
                                // Check if any session is active/responding
                                const activeSessions = exports[prop].filter((session: any) => {
                                    return session?.isActive || session?.isResponding || 
                                           session?.status === 'responding' || session?.status === 'active' ||
                                           session?.state === 'responding' || session?.state === 'active';
                                });
                                
                                if (activeSessions.length > 0) {
                                    isResponding = true;
                                    state = 'responding';
                                    console.log(`[BotBoss] Found ${activeSessions.length} active chat sessions`);
                                }
                            }
                            
                            // If it's an object, check its properties
                            else if (typeof exports[prop] === 'object' && exports[prop] !== null) {
                                const sessionObj = exports[prop];
                                if (sessionObj.isActive || sessionObj.isResponding || 
                                    sessionObj.status === 'responding' || sessionObj.state === 'responding') {
                                    isResponding = true;
                                    state = 'responding';
                                    console.log(`[BotBoss] Found active session object`);
                                }
                            }
                        }
                    }
                    
                    // Also check for any method that might give us chat status
                    const statusMethods = ['getChatStatus', 'getStatus', 'getChatState', 'getState'];
                    for (const method of statusMethods) {
                        if (typeof exports[method] === 'function') {
                            try {
                                const status = exports[method]();
                                console.log(`[BotBoss] Called ${method}():`, status);
                                
                                if (status && typeof status === 'object') {
                                    if (status.isResponding || status.responding || status.isGenerating) {
                                        isResponding = true;
                                        state = 'responding';
                                    } else if (status.isActive || status.active) {
                                        state = 'active';
                                    }
                                } else if (typeof status === 'string') {
                                    state = status;
                                    if (status.includes('respond') || status.includes('generat') || status.includes('working')) {
                                        isResponding = true;
                                    }
                                }
                            } catch (methodError) {
                                console.log(`[BotBoss] Error calling ${method}:`, methodError);
                            }
                        }
                    }
                }

                return {
                    isActive: true,
                    state: state,
                    isResponding: isResponding
                };
            }

            // Fallback: check VS Code Chat API if available
            const chatApi = (vscode as any).chat;
            if (chatApi) {
                console.log('[BotBoss] Checking VS Code Chat API...');
                
                // Get current chat state
                const currentState = this.lastChatState || chatApi.state;
                
                // Check for various indicators of chat activity
                const isResponding = chatApi.isResponding === true || 
                                   chatApi.responding === true ||
                                   chatApi.isGenerating === true ||
                                   chatApi.generating === true ||
                                   chatApi.isBusy === true ||
                                   chatApi.busy === true;

                const stateString = typeof currentState === 'string' ? currentState : 
                                  isResponding ? 'responding' : 'idle';

                return {
                    isActive: true,
                    state: stateString,
                    isResponding: !!isResponding
                };
            }

            return { isActive: false };
        } catch (error) {
            console.error('[BotBoss] Error getting chat state info:', error);
            return { isActive: false };
        }
    }

    /**
     * Alternative method to detect chat activity using various VS Code APIs
     */
    private detectChatActivityAlternative(): CopilotChatInfo {
        try {
            console.log('[BotBoss] Trying alternative chat activity detection...');
            
            // Method 1: Check for active text editors with copilot-related activity
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const document = activeEditor.document;
                
                // Check if document was recently modified (could indicate chat suggestions being applied)
                const now = Date.now();
                const docChangeTime = (document as any).lastChangeTime || 0;
                if (now - docChangeTime < 5000) { // Within last 5 seconds
                    console.log('[BotBoss] Recent document changes detected');
                    return {
                        isActive: true,
                        state: 'active',
                        isResponding: true,
                        lastChatActivity: new Date().toISOString()
                    };
                }
            }
            
            // Method 2: Check VS Code's command palette or recent commands
            // This is indirect but could indicate copilot chat usage
            try {
                // Look for copilot-related commands that were recently executed
                const recentCommands = (vscode as any).commands?.getCommands?.(true) || [];
                const copilotChatCommands = recentCommands.filter((cmd: string) => 
                    cmd.includes('copilot') && (cmd.includes('chat') || cmd.includes('explain') || cmd.includes('generate'))
                );
                
                if (copilotChatCommands.length > 0) {
                    console.log('[BotBoss] Found copilot chat commands:', copilotChatCommands.slice(0, 3));
                }
            } catch (cmdError) {
                console.log('[BotBoss] Could not check commands:', cmdError);
            }
            
            // Method 3: Check for copilot chat webview panels or views
            // Chat interface might be running in a webview
            try {
                // This is a bit hacky, but check if there are any webview panels with copilot-related titles
                if ((vscode.window as any).visibleNotebookEditors || (vscode.window as any).terminals) {
                    // Indirect indicators that something might be happening
                    console.log('[BotBoss] VS Code has active components, checking for chat activity...');
                }
            } catch (webviewError) {
                console.log('[BotBoss] Could not check webviews:', webviewError);
            }
            
            // Method 4: Check workspace state or global state for chat activity markers
            if (this.context) {
                try {
                    const chatState = this.context.globalState.get('copilot.chat.state');
                    const chatActivity = this.context.workspaceState.get('copilot.chat.activity');
                    
                    if (chatState || chatActivity) {
                        console.log('[BotBoss] Found chat state in VS Code storage:', { chatState, chatActivity });
                        
                        // Check if the stored state indicates recent activity
                        if (typeof chatActivity === 'object' && chatActivity) {
                            const lastActivity = (chatActivity as any).lastActivity;
                            if (lastActivity) {
                                const activityTime = new Date(lastActivity).getTime();
                                const now = Date.now();
                                if (now - activityTime < 30000) { // Within last 30 seconds
                                    return {
                                        isActive: true,
                                        state: 'responding',
                                        isResponding: true,
                                        lastChatActivity: lastActivity
                                    };
                                }
                            }
                        }
                    }
                } catch (stateError) {
                    console.log('[BotBoss] Could not check VS Code state:', stateError);
                }
            }
            
            return {
                isActive: false,
                state: 'idle',
                isResponding: false
            };
            
        } catch (error) {
            console.error('[BotBoss] Error in alternative chat detection:', error);
            return {
                isActive: false,
                state: 'idle',
                isResponding: false
            };
        }
    }

    private async pollOnce(): Promise<CopilotInfo | undefined> {
        if (this.disposed) return; // ignore after dispose
        try {
            const info = await this.instanceService.getCopilotInfo();
            
            // Add chat state information
            const chatInfo = this.getChatStateInfo();
            if (chatInfo.isActive) {
                const chatData: CopilotChatInfo = {
                    isActive: chatInfo.isActive,
                    state: chatInfo.state,
                    isResponding: chatInfo.isResponding,
                    lastChatActivity: chatInfo.isResponding ? new Date().toISOString() : undefined
                };
                
                (info as any).chat = chatData;
                
                // If chat is responding, update main status to reflect this
                if (chatInfo.isResponding) {
                    info.status = 'Generating';
                    info.detailHint = 'Copilot Chat is responding';
                    console.log('[BotBoss] Chat is responding - updating main status to Generating');
                } else if (chatInfo.state && chatInfo.state !== 'idle' && chatInfo.state !== 'unknown') {
                    // If chat has some state but not actively responding
                    if (info.status === 'Idle') {
                        info.detailHint = `Copilot Chat: ${chatInfo.state}`;
                    }
                }
            } else {
                // Try alternative detection methods if primary chat detection failed
                const alternativeStatus = this.detectChatActivityAlternative();
                if (alternativeStatus.isActive) {
                    (info as any).chat = alternativeStatus;
                    if (alternativeStatus.isResponding) {
                        info.status = 'Generating';
                        info.detailHint = 'Copilot Chat activity detected';
                        console.log('[BotBoss] Alternative chat detection found activity');
                    }
                }
            }
            
            // Stamp lastActivity to ensure monotonic ordering if missing
            if (!info.lastActivity) {
                info.lastActivity = new Date().toISOString();
            }
            this.appendHistory(info);
            if (!this.hasMeaningfulChange(this.lastStatus, info)) {
                return info; // unchanged
            }
            this.lastStatus = info;
            this.emitter.fire(info);
            return info;
        } catch (err) {
            // Emit an error state only if previous state wasn't already an error
            if (!this.lastStatus || this.lastStatus.status !== 'Error') {
                const errorInfo: CopilotInfo = {
                    isInstalled: false,
                    isActive: false,
                    status: 'Error',
                    error: err instanceof Error ? err.message : String(err),
                    detailHint: 'Unexpected error reading Copilot status'
                };
                this.appendHistory(errorInfo);
                this.lastStatus = errorInfo;
                this.emitter.fire(errorInfo);
                return errorInfo;
            }
        }
        return this.lastStatus;
    }

    private hasMeaningfulChange(a?: CopilotInfo, b?: CopilotInfo): boolean {
        if (!a || !b) return true;
        
        // Check main properties
        const mainChanged = a.status !== b.status ||
               a.isInstalled !== b.isInstalled ||
               a.isActive !== b.isActive ||
               a.version !== b.version ||
               a.error !== b.error;
               
        // Check chat state changes
        const aChatInfo = (a as any).chat;
        const bChatInfo = (b as any).chat;
        const chatChanged = (!aChatInfo && bChatInfo) ||
                           (aChatInfo && !bChatInfo) ||
                           (aChatInfo && bChatInfo && (
                               aChatInfo.isActive !== bChatInfo.isActive ||
                               aChatInfo.state !== bChatInfo.state ||
                               aChatInfo.isResponding !== bChatInfo.isResponding
                           ));
        
        return mainChanged || chatChanged;
    }
}

// -------- History Support --------
export interface CopilotHistoryEntry {
    timestamp: string; // ISO
    status: CopilotInfo['status'];
    isInstalled: boolean;
    isActive: boolean;
    detailHint?: string;
    error?: string;
}

export interface CopilotAggregatedSummary {
    worstStatus: CopilotInfo['status'];
    worstSeverity: number;
    counts: Record<string, number>;
    total: number;
}

export function summarizeCopilotStatuses(statuses: CopilotInfo[]): CopilotAggregatedSummary {
    const counts: Record<string, number> = {};
    let worstStatus: CopilotInfo['status'] = 'Idle';
    let worstSeverity = -1;
    for (const s of statuses) {
        counts[s.status] = (counts[s.status] || 0) + 1;
        const sev = CopilotStatusService.severity(s.status);
        if (sev > worstSeverity) {
            worstSeverity = sev;
            worstStatus = s.status;
        }
    }
    return { worstStatus, worstSeverity, counts, total: statuses.length };
}

// Methods added onto prototype (below class for clarity)
CopilotStatusService.prototype.getHistory = function(): CopilotHistoryEntry[] {
    return [...this.history];
};

(CopilotStatusService.prototype as any).appendHistory = function(info: CopilotInfo) {
    const entry: CopilotHistoryEntry = {
        timestamp: new Date().toISOString(),
        status: info.status,
        isInstalled: info.isInstalled,
        isActive: info.isActive,
        detailHint: info.detailHint,
        error: info.error
    };
    this.history.push(entry);
    this.trimHistory();
    this.persistHistory();
};

(CopilotStatusService.prototype as any).trimHistory = function() {
    if (this.history.length > this.maxEntries) {
        this.history.splice(0, this.history.length - this.maxEntries);
    }
};

(CopilotStatusService.prototype as any).persistHistory = function() {
    if (!this.context) return;
    try {
        this.context.globalState.update(CopilotStatusService.HISTORY_KEY, this.history);
    } catch {}
};

(CopilotStatusService.prototype as any).loadHistory = function() {
    if (!this.context) return;
    try {
        const stored = this.context.globalState.get(CopilotStatusService.HISTORY_KEY, [] as any);
        if (Array.isArray(stored)) {
            this.history = stored.slice(-this.maxEntries);
        }
    } catch {}
};

(CopilotStatusService.prototype as any).applyConfig = function() {
    const cfg = vscode.workspace.getConfiguration('bot-boss');
    const max = cfg.get<number>('copilot.history.maxEntries');
    if (typeof max === 'number' && max > 5) {
        this.maxEntries = max;
    }
    const poll = cfg.get<number>('copilot.pollIntervalMs');
    if (typeof poll === 'number' && poll >= 2000 && poll !== this.intervalMs) {
        this.intervalMs = poll;
        // Restart timer with new interval
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = setInterval(() => this.pollOnce(), this.intervalMs);
        }
    }
};

// Type augmentation for TS consumers
export interface CopilotStatusService {
    getHistory(): CopilotHistoryEntry[];
    appendHistory(info: CopilotInfo): void;
    trimHistory(): void;
    persistHistory(): void;
    loadHistory(): void;
    applyConfig(): void;
}
