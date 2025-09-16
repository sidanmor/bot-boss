# Bot Boss - VS Code Instance Manager

A VS Code extension that helps you manage and monitor all your open VS Code instances from within VS Code using an innovative shared file approach.

## Features

- **List All VS Code Instances**: See all running VS Code instances that have this extension installed
- **Shared File Technology**: Uses a shared file system for reliable instance detection across all VS Code windows
- **Workspace Detection**: Automatically detects which workspace/folder each instance has open
- **Git Integration**: Shows git branch, status, commit info, and sync status for each workspace
- **Clickable Instance Links**: Click directly on any instance name to focus that window
- **Performance Monitoring**: View memory usage and uptime for each instance
- **Quick Focus**: Click to bring any VS Code window to the foreground
- **Detailed Information**: View workspace details and git information
- **Auto-refresh**: Automatically updates the list every 30 seconds
- **Real-time Updates**: Each VS Code instance updates its status every 30 seconds with heartbeat mechanism

## How It Works

This extension uses a revolutionary **shared file approach** instead of process detection:

1. **Each VS Code instance** with this extension installed writes its details to a shared JSON file in the system temp directory
2. **Heartbeat mechanism** ensures each instance updates its status every 30 seconds and removes stale entries
3. **File locking** prevents corruption when multiple instances write simultaneously  
4. **Automatic cleanup** removes instance data when VS Code windows close
5. **Fallback detection** uses process detection only if shared file is empty

### Shared File Location
- **Windows**: `%TEMP%\vscode-instances.json`
- **macOS**: `/tmp/vscode-instances.json` 
- **Linux**: `/tmp/vscode-instances.json`

## How to Use

1. Install the extension in **each VS Code instance** you want to monitor
2. Open the "Bot Boss" view in the Activity Bar (sidebar)
3. **Click on any VS Code instance name to instantly focus that window**
4. Expand instances to see detailed information including:
   - Workspace path
   - Git branch and status
   - Commit information  
   - Remote repository
   - Process details (PID, memory, uptime)
5. Right-click on any instance for additional options:
   - Focus the window
   - View detailed workspace information
6. Click the refresh button to manually update the list

## Requirements for All Instances

**Important**: For the shared file approach to work effectively, you should install this extension in **every VS Code instance** you want to monitor. Instances without the extension will only be detected through fallback process detection (less reliable).

## Git Information Display

For each VS Code instance with a git workspace, you'll see:

- **Branch name** in the description (e.g., "main", "feature/new-ui")
- **Uncommitted changes** indicator (*) 
- **Sync status**: ↑2 (ahead), ↓1 (behind) commits
- **Detailed git info** when expanded:
  - Current branch
  - Working tree status (clean/dirty)
  - Last commit message and hash
  - Remote repository URL
  - Sync status with upstream

## Features in Detail

### Shared File Instance Detection
The extension's primary method uses a shared file system:
- Each VS Code instance registers itself in a shared JSON file
- Includes workspace path, git info, memory usage, and session details
- 30-second heartbeat keeps instance data fresh
- Automatic cleanup when instances close
- File locking prevents data corruption

### Fallback Process Detection
If the shared file is empty, falls back to process scanning:
- Scans for `Code.exe` processes  
- Extracts workspace info from window titles and command lines
- Less reliable but works for instances without the extension

### Git Integration
For each workspace that contains a git repository, the extension shows:
- Current branch name
- Working tree status (clean/uncommitted changes)  
- Commits ahead/behind upstream
- Last commit information
- Remote repository URL

### Window Management
- **Click to Focus**: Simply click on any instance name to bring that window to front
- **Context Menu**: Right-click for additional options
- **Detailed View**: Expand instances to see all available information

## Example Display

```
📁 VS Code - my-project • main (*) ↑2 ↓1         [85MB]
├─ 📁 C:\Projects\my-project
├─ 🌿 Branch: main (uncommitted changes)
├─ 🔄 ↑2 ahead, ↓1 behind  
├─ 📝 abc1234 Fix navigation bug
├─ 🌐 github.com/user/my-project
├─ 🆔 PID: 12345
├─ 💾 Memory: 85 MB
└─ ⏱️ Uptime: 2h 15m
```

## System Requirements

- VS Code 1.74.0 or higher
- Cross-platform: Windows, macOS, Linux
- Node.js (included with VS Code)

## Installation

1. Download the `.vsix` file
2. In VS Code, go to Extensions view
3. Click the "..." menu and select "Install from VSIX..."
4. Select the downloaded `.vsix` file
5. **Install in all VS Code instances** for best results

## Testing the Shared File

You can test if the shared file is working by running:

```bash
node test-shared-file.js
```

This will show you the current contents of the shared file and any registered instances.

## Development

To build from source:

```bash
npm install
npm run compile
npx vsce package
```

## Advantages of Shared File Approach

- **More Reliable**: No dependency on process detection or Windows-specific APIs
- **Cross-Platform**: Works identically on Windows, macOS, and Linux
- **Rich Data**: Can include detailed workspace and git information
- **Real-time**: Updates automatically as instances start/stop
- **No Permissions**: Doesn't require elevated permissions
- **Extensible**: Easy to add more instance metadata

## Known Limitations

- Requires the extension to be installed in each VS Code instance for full functionality
- Shared file is cleared when all instances with the extension close
- Very rarely, file locking might cause a brief delay in updates

## Future Enhancements

- Ability to close remote instances
- Workspace switching from any instance
- Instance grouping by project
- Custom commands sent between instances
- Shared workspace bookmarks

## License

[Add your license here]