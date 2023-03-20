const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { findParentModules } = require('./find-parent-modules');
const { findChildPackages } = require('./find-child-packages');
const { showError } = require('./utils');

var lastFolder = '';
var lastWorkspaceName = '';
var lastWorkspaceRoot = '';

const nodeModules = 'node_modules';

exports.activate = context => {
    const searchNodeModules = vscode.commands.registerCommand('extension.search', () => {
        const preferences = vscode.workspace.getConfiguration('search-node-modules-plus');

        const useLastFolder = preferences.get('useLastFolder', false);
        const nodeModulesPath = preferences.get('path', nodeModules);
        const searchParentModules = preferences.get('searchParentModules', true);

        const searchPath = (workspaceName, workspaceRoot, folderPath) => {
            // Path to node_modules in this workspace folder
            const workspaceNodeModules = path.join(workspaceName, nodeModulesPath);

            // Reset last folder
            lastFolder = '';
            lastWorkspaceName = '';
            lastWorkspaceRoot = '';

            // Path to current folder
            const folderFullPath = path.join(workspaceRoot, folderPath);

            // Read folder, built quick pick with files/folder (and shortcuts)
            fs.readdir(folderFullPath, async (readErr, files) => {
                if (readErr) {
                    if (folderPath === nodeModulesPath) {
                        return showError('No node_modules folder in this workspace.');
                    }

                    return showError(`Unable to open folder ${folderPath}`);
                }

                const isParentFolder = folderPath.includes('..');
                const options = files;

                // If searching in root node_modules, also include modules from parent folders, that are outside of the workspace
                if (folderPath === nodeModulesPath) {
                    if (searchParentModules) {
                        const parentModules = await findParentModules(workspaceRoot, nodeModulesPath);
                        options.push(...parentModules);
                    }
                } else {
                    // Otherwise, show option to move back to root
                    options.push('');
                    options.push(workspaceNodeModules);

                    // If current folder is not outside of the workspace, also add option to move a step back
                    if (!isParentFolder) {
                        options.push('..');
                    }
                }

                const quickPick = vscode.window.createQuickPick();
                quickPick.placeholder = path.format({ dir: workspaceName, base: folderPath });
                quickPick.items = options.map((fileName) => {
                    let quickPickItem = { label: fileName, kind: fileName === '' ? vscode.QuickPickItemKind.Separator : vscode.QuickPickItemKind.Default }; // if filename is empty, it means it's a separator
                    if (fileName !== workspaceNodeModules && fileName !== '') {
                        const filePath = path.join(folderPath, fileName);
                        const fileFullPath = path.join(workspaceRoot, filePath);
                        quickPickItem.value = fileFullPath;
                        const stats = fs.statSync(fileFullPath);
                        if (stats.isDirectory() && fs.existsSync(path.join(fileFullPath, 'package.json'))) {
                            quickPickItem.buttons = [ {
                                iconPath: {
                                    'light': 'resource/light/open-package.svg',
                                    'dark': 'resource/dark/open-package.svg'
                                },
                                tooltip: 'open package'
                            } ];
                        }
                    }
                    return quickPickItem;
                });
                quickPick.onDidChangeSelection((selection) => {
                    const selected = selection[0].label;
                    // node_modules shortcut selected
                    if (selected === workspaceNodeModules) {
                        searchPath(workspaceName, workspaceRoot, nodeModulesPath);
                    } else {
                        const selectedPath = path.join(folderPath, selected);
                        const selectedFullPath = path.join(workspaceRoot, selectedPath);

                        // If selected is a folder, traverse it,
                        // otherwise open file.
                        fs.stat(selectedFullPath, (statErr, stats) => {
                            if (stats.isDirectory()) {
                                searchPath(workspaceName, workspaceRoot, selectedPath);
                            } else {
                                lastWorkspaceName = workspaceName;
                                lastWorkspaceRoot = workspaceRoot;
                                lastFolder = folderPath;

                                vscode.workspace.openTextDocument(selectedFullPath, selectedPath)
                                    .then(vscode.window.showTextDocument);
                            }
                        });
                    }
                });
                quickPick.onDidTriggerItemButton(e => {
                    vscode.workspace.openTextDocument(path.join(e.item.value, 'package.json'))
                                    .then(vscode.window.showTextDocument);
                });
                quickPick.onDidHide(() => quickPick.dispose());
                quickPick.show();
            });
        };

        const getProjectFolder = async (workspaceFolder) => {
            const packages = await findChildPackages(workspaceFolder.uri.fsPath);
            // If in a lerna/yarn monorepo, prompt user to select which project to traverse
            if (packages.length > 0) {
                const selected = await vscode.window.showQuickPick(
                    [
                        { label: workspaceFolder.name, packageDir: '' }, // First option is the root dir
                        ...packages.map(packageDir => ({ label: path.join(workspaceFolder.name, packageDir), packageDir }))
                    ]
                    , { placeHolder: 'Select Project' }
                );
                if (!selected) {
                    return;
                }

                return {
                    name: selected.label,
                    path: path.join(workspaceFolder.uri.fsPath, selected.packageDir)
                };
            }

            // Otherwise, use the root folder
            return {
                name: workspaceFolder.name,
                path: workspaceFolder.uri.fsPath
            };
        };

        const getWorkspaceFolder = async () => {
            // If in a multifolder workspace, prompt user to select which one to traverse.
            if (vscode.workspace.workspaceFolders.length > 1) {
                const selected = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders.map(folder => ({
                    label: folder.name,
                    folder
                })), {
                    placeHolder: 'Select workspace folder'
                });

                if (!selected) {
                    return;
                }

                return selected.folder;
            }

            // Otherwise, use the first one
            const folder = vscode.workspace.workspaceFolders[0];
            return folder;
        };

        // Open last folder if there is one
        if (useLastFolder && lastFolder) {
            return searchPath(lastWorkspaceName, lastWorkspaceRoot, lastFolder);
        }

        // Must have at least one workspace folder
        if (!vscode.workspace.workspaceFolders.length) {
            return showError('You must have a workspace opened.');
        }

        getWorkspaceFolder().then(folder => folder && getProjectFolder(folder)).then(folder => {
            if (folder) {
                searchPath(folder.name, folder.path, nodeModulesPath);
            }
        });
    });

    context.subscriptions.push(searchNodeModules);
};

exports.deactivate = () => { };
