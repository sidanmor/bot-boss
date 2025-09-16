# Bot Boss - VS Code Instance Manager

A VS Code extension that helps you manage and monitor all your open VS Code instances from within VS Code.

## Features

- **List All VS Code Instances**: See all running VS Code processes with detailed information
- **Workspace Detection**: Automatically detects which workspace/folder each instance has open
- **Git Integration**: Shows git branch, status, commit info, and sync status for each workspace
- **Clickable Instance Links**: Click directly on any instance name to focus that window
- **Performance Monitoring**: View memory usage, CPU usage, and uptime for each instance
- **Quick Focus**: Click to bring any VS Code window to the foreground
- **Detailed Information**: View command line arguments and process details
- **Auto-refresh**: Automatically updates the list every 30 seconds

## How to Use

1. Install the extension
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

### Instance Detection
The extension detects VS Code instances by scanning for `Code.exe` processes and extracts:
- Process ID (PID)
- Workspace/folder path
- Memory usage
- CPU usage
- Uptime
- Command line arguments
- Git repository information

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

- Windows OS (currently Windows-specific due to PowerShell dependencies)
- VS Code 1.74.0 or higher

## Installation

1. Download the `.vsix` file
2. In VS Code, go to Extensions view
3. Click the "..." menu and select "Install from VSIX..."
4. Select the downloaded `.vsix` file

## Development

To build from source:

```bash
npm install
npm run compile
npx vsce package
```

## Known Limitations

- Currently Windows-only (uses PowerShell and Windows-specific APIs)
- Requires administrative permissions for some process information
- May not detect all VS Code instances if they're running with different permissions

## Future Enhancements

- Cross-platform support (macOS, Linux)
- Ability to close instances
- Workspace switching
- Performance graphs
- Instance grouping by workspace

## License

[Add your license here]