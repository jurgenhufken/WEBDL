#!/usr/bin/env python3
"""
WEBDL Directory Filter
PySide6 tool to select/deselect directories for gallery filtering
"""
import sys
import os
import json
from pathlib import Path
from PySide6.QtWidgets import (QApplication, QMainWindow, QTreeView, QVBoxLayout, 
                               QHBoxLayout, QWidget, QPushButton, QLabel, QFileSystemModel)
from PySide6.QtCore import Qt, QDir, QModelIndex, Signal
from PySide6.QtGui import QStandardItemModel, QStandardItem

CONFIG_FILE = Path.home() / '.config' / 'webdl' / 'directory-filter.json'
BASE_DIR = Path.home() / 'Downloads' / 'WEBDL'

class DirectoryFilterModel(QStandardItemModel):
    """Model with checkable directory items"""
    
    def __init__(self, root_path):
        super().__init__()
        self.root_path = Path(root_path)
        self.checked_paths = set()
        self.load_config()
        self.populate_tree()
    
    def load_config(self):
        """Load previously selected directories"""
        self.first_run = False
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    self.checked_paths = set(data.get('enabled_dirs', []))
                    print(f"📁 Loaded {len(self.checked_paths)} directories from config")
            except Exception as e:
                print(f"Config load error: {e}")
                self.first_run = True
        else:
            print("⚠️  No config found - will select all directories by default")
            self.first_run = True
    
    def save_config(self):
        """Save selected directories to config"""
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump({
                    'enabled_dirs': sorted(list(self.checked_paths)),
                    'base_dir': str(self.root_path)
                }, f, indent=2)
            print(f"✅ Saved {len(self.checked_paths)} directories to {CONFIG_FILE}")
        except Exception as e:
            print(f"Config save error: {e}")
    
    def populate_tree(self, parent_item=None, parent_path=None):
        """Recursively populate tree with directories"""
        if parent_item is None:
            parent_item = self.invisibleRootItem()
            parent_path = self.root_path
            print(f"🔍 Scanning {parent_path}...")
        
        if not parent_path.is_dir():
            return
        
        try:
            # Get subdirectories, sorted
            subdirs = sorted([d for d in parent_path.iterdir() if d.is_dir()], 
                           key=lambda x: x.name.lower())
            
            if parent_item == self.invisibleRootItem():
                print(f"📂 Found {len(subdirs)} top-level directories")
            
            for subdir in subdirs:
                # Skip hidden and system directories
                if subdir.name.startswith('.') or subdir.name in ['__pycache__', 'node_modules']:
                    continue
                
                rel_path = str(subdir.relative_to(self.root_path))
                
                item = QStandardItem(subdir.name)
                item.setCheckable(True)
                item.setData(rel_path, Qt.UserRole)
                
                # Set check state based on config, or select all on first run
                if self.first_run or rel_path in self.checked_paths:
                    item.setCheckState(Qt.Checked)
                else:
                    item.setCheckState(Qt.Unchecked)
                
                parent_item.appendRow(item)
                
                # Recursively add subdirectories (max depth 3 for performance)
                depth = len(Path(rel_path).parts)
                if depth < 3:
                    self.populate_tree(item, subdir)
        
        except PermissionError:
            pass
    
    def update_checked_paths(self):
        """Update the set of checked paths from tree state"""
        self.checked_paths.clear()
        
        def traverse(item):
            if item.isCheckable() and item.checkState() == Qt.Checked:
                rel_path = item.data(Qt.UserRole)
                if rel_path:
                    self.checked_paths.add(rel_path)
            
            for row in range(item.rowCount()):
                child = item.child(row)
                if child:
                    traverse(child)
        
        traverse(self.invisibleRootItem())


class DirectoryFilterWindow(QMainWindow):
    """Main window for directory filtering"""
    
    def __init__(self):
        super().__init__()
        self.setWindowTitle('WEBDL Directory Filter')
        self.setGeometry(100, 100, 600, 700)
        
        # Main widget and layout
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        
        # Info label
        info = QLabel(f'📁 Select directories to show in gallery\nBase: {BASE_DIR}')
        info.setStyleSheet('padding: 10px; background: #0b1020; color: #00d4ff; border-radius: 6px;')
        layout.addWidget(info)
        
        # Tree view
        self.tree = QTreeView()
        self.tree.setHeaderHidden(True)
        self.tree.setAlternatingRowColors(True)
        self.model = DirectoryFilterModel(BASE_DIR)
        self.tree.setModel(self.model)
        self.tree.expandToDepth(1)
        layout.addWidget(self.tree)
        
        # Stats label
        self.stats_label = QLabel()
        self.update_stats()
        self.stats_label.setStyleSheet('padding: 8px; color: #9aa7d1; font-size: 12px;')
        layout.addWidget(self.stats_label)
        
        # Buttons
        button_layout = QHBoxLayout()
        
        btn_select_all = QPushButton('✓ Select All')
        btn_select_all.clicked.connect(self.select_all)
        button_layout.addWidget(btn_select_all)
        
        btn_deselect_all = QPushButton('✗ Deselect All')
        btn_deselect_all.clicked.connect(self.deselect_all)
        button_layout.addWidget(btn_deselect_all)
        
        btn_refresh = QPushButton('↻ Refresh')
        btn_refresh.clicked.connect(self.refresh)
        button_layout.addWidget(btn_refresh)
        
        button_layout.addStretch()
        
        btn_cancel = QPushButton('Cancel')
        btn_cancel.clicked.connect(self.close)
        button_layout.addWidget(btn_cancel)
        
        btn_apply = QPushButton('✓ Apply')
        btn_apply.clicked.connect(self.save_and_apply)
        btn_apply.setStyleSheet('background: #2a4a82; font-weight: bold;')
        button_layout.addWidget(btn_apply)
        
        layout.addLayout(button_layout)
        
        # Connect model changes to stats update
        self.model.itemChanged.connect(self.update_stats)
        
        # Style
        self.setStyleSheet("""
            QMainWindow { background: #050816; }
            QTreeView { 
                background: #0b1020; 
                color: #eee; 
                border: 1px solid #1f2a52; 
                border-radius: 6px;
                font-size: 14px;
                padding: 4px;
            }
            QTreeView::item { 
                height: 28px;
                padding: 2px;
            }
            QTreeView::item:hover { background: #1f2a52; }
            QTreeView::item:selected { background: #2a4a82; }
            QTreeView::indicator {
                width: 18px;
                height: 18px;
            }
            QPushButton {
                background: #1f2a52;
                color: #d7e6ff;
                border: 1px solid #2a4a82;
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 13px;
            }
            QPushButton:hover { background: #2a4a82; }
            QPushButton:pressed { background: #0f3a72; }
        """)
    
    def update_stats(self):
        """Update statistics label"""
        self.model.update_checked_paths()
        count = len(self.model.checked_paths)
        self.stats_label.setText(f'Selected: {count} directories')
    
    def select_all(self):
        """Check all items"""
        def check_all(item):
            if item.isCheckable():
                item.setCheckState(Qt.Checked)
            for row in range(item.rowCount()):
                child = item.child(row)
                if child:
                    check_all(child)
        
        check_all(self.model.invisibleRootItem())
        self.update_stats()
    
    def deselect_all(self):
        """Uncheck all items"""
        def uncheck_all(item):
            if item.isCheckable():
                item.setCheckState(Qt.Unchecked)
            for row in range(item.rowCount()):
                child = item.child(row)
                if child:
                    uncheck_all(child)
        
        uncheck_all(self.model.invisibleRootItem())
        self.update_stats()
    
    def refresh(self):
        """Reload directory tree"""
        self.model.populate_tree()
        self.tree.expandToDepth(1)
        self.update_stats()
    
    def save_and_apply(self):
        """Save current selection and apply"""
        self.model.update_checked_paths()
        self.model.save_config()
        self.update_stats()
        print("✅ Saved directory filter - gallery will auto-reload")
        
        # Notify server to reload gallery (optional - gallery can poll config)
        try:
            import urllib.request
            urllib.request.urlopen('http://localhost:35729/api/trigger-gallery-reload', timeout=1)
        except:
            pass
        
        self.close()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName('WEBDL Directory Filter')
    
    if not BASE_DIR.exists():
        print(f'❌ Base directory not found: {BASE_DIR}')
        sys.exit(1)
    
    window = DirectoryFilterWindow()
    window.show()
    
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
