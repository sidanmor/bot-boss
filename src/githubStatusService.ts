import * as https from 'https';

export interface GitHubStatusComponent {
    id: string;
    name: string;
    status: 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';
    created_at: string;
    updated_at: string;
    position: number;
    description: string;
    showcase: boolean;
    start_date?: string;
    group_id?: string;
    page_id: string;
    group: boolean;
    only_show_if_degraded: boolean;
}

export interface GitHubStatusIncident {
    id: string;
    name: string;
    status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
    created_at: string;
    updated_at: string;
    monitoring_at?: string;
    resolved_at?: string;
    impact: 'none' | 'minor' | 'major' | 'critical';
    shortlink: string;
    started_at: string;
    page_id: string;
    incident_updates: Array<{
        id: string;
        status: string;
        body: string;
        incident_id: string;
        created_at: string;
        updated_at: string;
        display_at: string;
        affected_components: Array<{
            code: string;
            name: string;
            old_status: string;
            new_status: string;
        }>;
        deliver_notifications: boolean;
        custom_tweet?: string;
        tweet_id?: string;
    }>;
    components: GitHubStatusComponent[];
    postmortem?: {
        body: string;
        body_html: string;
        published_at: string;
    };
}

export interface GitHubStatusPage {
    id: string;
    name: string;
    url: string;
    time_zone: string;
    updated_at: string;
}

export interface GitHubStatusSummary {
    page: GitHubStatusPage;
    components: GitHubStatusComponent[];
    incidents: GitHubStatusIncident[];
    scheduled_maintenances: any[];
    status: {
        indicator: 'none' | 'minor' | 'major' | 'critical';
        description: string;
    };
}

export class GitHubStatusService {
    private static instance: GitHubStatusService;
    private readonly apiBaseUrl = 'https://www.githubstatus.com/api/v2';
    private cachedStatus: GitHubStatusSummary | null = null;
    private lastFetchTime = 0;
    private readonly cacheExpiryMs = 60000; // 1 minute cache

    public static getInstance(): GitHubStatusService {
        if (!GitHubStatusService.instance) {
            GitHubStatusService.instance = new GitHubStatusService();
        }
        return GitHubStatusService.instance;
    }

    /**
     * Fetch GitHub status summary
     */
    async getGitHubStatus(): Promise<GitHubStatusSummary> {
        const now = Date.now();
        
        // Return cached data if it's still fresh
        if (this.cachedStatus && (now - this.lastFetchTime) < this.cacheExpiryMs) {
            console.log('Returning cached GitHub status');
            return this.cachedStatus;
        }

        try {
            console.log('Fetching fresh GitHub status from API...');
            const status = await this.fetchStatusFromAPI();
            this.cachedStatus = status;
            this.lastFetchTime = now;
            return status;
        } catch (error) {
            console.error('Failed to fetch GitHub status:', error);
            
            // Return cached data if available, even if expired
            if (this.cachedStatus) {
                console.log('Using expired cached GitHub status due to fetch error');
                return this.cachedStatus;
            }
            
            // Return a fallback status
            return this.createFallbackStatus(error);
        }
    }

    /**
     * Get the overall GitHub service status indicator
     */
    async getOverallStatus(): Promise<{
        indicator: 'operational' | 'degraded' | 'outage' | 'unknown';
        description: string;
        icon: string;
        color: string;
    }> {
        try {
            const status = await this.getGitHubStatus();
            
            // Map the status indicator to our format
            let indicator: 'operational' | 'degraded' | 'outage' | 'unknown';
            let icon: string;
            let color: string;
            
            switch (status.status.indicator) {
                case 'none':
                    indicator = 'operational';
                    icon = '🟢';
                    color = 'green';
                    break;
                case 'minor':
                    indicator = 'degraded';
                    icon = '🟡';
                    color = 'yellow';
                    break;
                case 'major':
                case 'critical':
                    indicator = 'outage';
                    icon = '🔴';
                    color = 'red';
                    break;
                default:
                    indicator = 'unknown';
                    icon = '❓';
                    color = 'gray';
                    break;
            }
            
            return {
                indicator,
                description: status.status.description,
                icon,
                color
            };
        } catch (error) {
            console.error('Error getting overall GitHub status:', error);
            return {
                indicator: 'unknown',
                description: 'Unable to fetch GitHub status',
                icon: '❓',
                color: 'gray'
            };
        }
    }

    /**
     * Get active incidents
     */
    async getActiveIncidents(): Promise<GitHubStatusIncident[]> {
        try {
            const status = await this.getGitHubStatus();
            // Filter for unresolved incidents
            return status.incidents.filter(incident => 
                incident.status !== 'resolved' && 
                incident.impact !== 'none'
            );
        } catch (error) {
            console.error('Error getting active incidents:', error);
            return [];
        }
    }

    /**
     * Get components with issues
     */
    async getComponentsWithIssues(): Promise<GitHubStatusComponent[]> {
        try {
            const status = await this.getGitHubStatus();
            return status.components.filter(component => 
                component.status !== 'operational'
            );
        } catch (error) {
            console.error('Error getting components with issues:', error);
            return [];
        }
    }

    /**
     * Fetch status from GitHub Status API
     */
    private async fetchStatusFromAPI(): Promise<GitHubStatusSummary> {
        return new Promise((resolve, reject) => {
            const url = `${this.apiBaseUrl}/summary.json`;
            
            const request = https.get(url, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        if (response.statusCode !== 200) {
                            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                            return;
                        }
                        
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse JSON: ${parseError}`));
                    }
                });
            });
            
            request.on('error', (error) => {
                reject(new Error(`Network error: ${error.message}`));
            });
            
            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Create a fallback status when API is unavailable
     */
    private createFallbackStatus(error: any): GitHubStatusSummary {
        return {
            page: {
                id: 'fallback',
                name: 'GitHub Status',
                url: 'https://www.githubstatus.com',
                time_zone: 'UTC',
                updated_at: new Date().toISOString()
            },
            components: [],
            incidents: [],
            scheduled_maintenances: [],
            status: {
                indicator: 'none',
                description: `Unable to fetch status: ${error?.message || 'Unknown error'}`
            }
        };
    }

    /**
     * Clear cached status (force refresh on next request)
     */
    clearCache(): void {
        this.cachedStatus = null;
        this.lastFetchTime = 0;
        console.log('GitHub status cache cleared');
    }

    /**
     * Get a detailed status report as a formatted string
     */
    async getStatusReport(): Promise<string> {
        try {
            const status = await this.getGitHubStatus();
            const overall = await this.getOverallStatus();
            const activeIncidents = await this.getActiveIncidents();
            const problemComponents = await this.getComponentsWithIssues();
            
            const lines: string[] = [];
            lines.push('🐙 GitHub Status Report');
            lines.push(`Generated: ${new Date().toLocaleString()}`);
            lines.push('');
            
            // Overall status
            lines.push(`Overall Status: ${overall.icon} ${overall.description}`);
            lines.push('');
            
            // Active incidents
            if (activeIncidents.length > 0) {
                lines.push('🚨 Active Incidents:');
                for (const incident of activeIncidents) {
                    const impactIcon = this.getImpactIcon(incident.impact);
                    lines.push(`  ${impactIcon} ${incident.name} (${incident.status})`);
                    if (incident.incident_updates.length > 0) {
                        const latestUpdate = incident.incident_updates[0];
                        const updateTime = new Date(latestUpdate.created_at).toLocaleString();
                        lines.push(`    Latest: ${latestUpdate.body} (${updateTime})`);
                    }
                }
                lines.push('');
            }
            
            // Components with issues
            if (problemComponents.length > 0) {
                lines.push('⚠️ Components with Issues:');
                for (const component of problemComponents) {
                    const statusIcon = this.getComponentStatusIcon(component.status);
                    lines.push(`  ${statusIcon} ${component.name}: ${component.status}`);
                }
                lines.push('');
            }
            
            // If everything is operational
            if (activeIncidents.length === 0 && problemComponents.length === 0) {
                lines.push('✅ All GitHub services are operational');
                lines.push('');
            }
            
            lines.push(`Last updated: ${new Date(status.page.updated_at).toLocaleString()}`);
            lines.push('');
            lines.push('For more details, visit: https://www.githubstatus.com');
            
            return lines.join('\n');
        } catch (error) {
            return `Error generating GitHub status report: ${error}`;
        }
    }

    /**
     * Get icon for incident impact level
     */
    private getImpactIcon(impact: string): string {
        switch (impact) {
            case 'critical': return '🔴';
            case 'major': return '🟠';
            case 'minor': return '🟡';
            case 'none': return '🟢';
            default: return '❓';
        }
    }

    /**
     * Get icon for component status
     */
    private getComponentStatusIcon(status: string): string {
        switch (status) {
            case 'operational': return '🟢';
            case 'degraded_performance': return '🟡';
            case 'partial_outage': return '🟠';
            case 'major_outage': return '🔴';
            default: return '❓';
        }
    }
}
