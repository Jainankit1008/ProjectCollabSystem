import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { MonacoBinding } from 'y-monaco';
import { Code2, Users, Video, VideoOff, Terminal as TerminalIcon, Eye, Plus, FolderOpen, Save, FileText } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const ROOM_ID = 'collaborative-editor-demo';

type Panel = 'preview' | 'terminal' | 'none';

interface File {
  id: string;
  name: string;
  language: string;
  content: string;
}

function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function App() {
  const editorRef = useRef<any>(null);
  const [files, setFiles] = useState<File[]>([
    { id: '1', name: 'index.html', language: 'html', content: '' },
    { id: '2', name: 'styles.css', language: 'css', content: '' },
    { id: '3', name: 'script.js', language: 'javascript', content: '' },
  ]);
  const [activeFileId, setActiveFileId] = useState<string>('1');
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [peers, setPeers] = useState<Set<string>>(new Set());
  const [rightPanel, setRightPanel] = useState<Panel>('none');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideosRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const bindingsRef = useRef<Map<string, MonacoBinding>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const activeFile = files.find(f => f.id === activeFileId)!;

  const handleResize = useCallback(debounce(() => {
    if (editorRef.current) {
      editorRef.current.layout();
    }
  }, 100), []);

  useEffect(() => {
    // Initialize resize observer
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver(handleResize);
      const editorContainer = document.querySelector('.monaco-editor');
      if (editorContainer) {
        resizeObserverRef.current.observe(editorContainer);
      }
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [handleResize]);

  useEffect(() => {
    // Initialize Yjs only once
    if (!providerRef.current) {
      const doc = new Y.Doc();
      const provider = new WebrtcProvider(`${ROOM_ID}-${Date.now()}`, doc, {
        signaling: ['wss://signaling.yjs.dev']
      });
      providerRef.current = provider;

      // Track peers
      const updatePeers = () => {
        setPeers(new Set(provider.awareness.getStates().keys()));
      };
      provider.awareness.on('change', updatePeers);

      // Initialize text for each file
      files.forEach(file => {
        const yText = doc.getText(`file-${file.id}`);
        if (editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            const binding = new MonacoBinding(yText, model, new Set([editorRef.current]), provider.awareness);
            bindingsRef.current.set(file.id, binding);
          }
        }
      });

      return () => {
        provider.disconnect();
        provider.awareness.off('change', updatePeers);
        doc.destroy();
        providerRef.current = null;
      };
    }
  }, [files]);

  // Initialize terminal
  useEffect(() => {
    if (terminalRef.current && rightPanel === 'terminal') {
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        theme: {
          background: '#1e1e1e',
        }
      });
      
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      
      terminal.open(terminalRef.current);
      fitAddon.fit();
      
      terminal.write('Welcome to the collaborative terminal!\r\n$ ');
      
      terminal.onData(data => {
        terminal.write(data);
      });

      return () => {
        terminal.dispose();
      };
    }
  }, [rightPanel]);

  // Handle editor mounting separately
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    if (providerRef.current) {
      files.forEach(file => {
        const yText = providerRef.current!.doc.getText(`file-${file.id}`);
        const binding = new MonacoBinding(yText, editor.getModel(), new Set([editor]), providerRef.current!.awareness);
        bindingsRef.current.set(file.id, binding);
      });
    }

    editor.onDidChangeModelContent(() => {
      const content = editor.getValue();
      setFiles(prev => prev.map(f => 
        f.id === activeFileId ? { ...f, content } : f
      ));
    });
  };

  // Update preview
  useEffect(() => {
    if (previewRef.current && rightPanel === 'preview') {
      const preview = previewRef.current;
      const doc = preview.contentDocument;
      
      if (doc) {
        const htmlFile = files.find(f => f.name.endsWith('.html'))?.content || '';
        const cssFile = files.find(f => f.name.endsWith('.css'))?.content || '';
        const jsFile = files.find(f => f.name.endsWith('.js'))?.content || '';

        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>${cssFile}</style>
            </head>
            <body>
              ${htmlFile}
              <script>${jsFile}</script>
            </body>
          </html>
        `);
        doc.close();
      }
    }
  }, [files, rightPanel]);

  useEffect(() => {
    // Set up WebRTC video
    if (videoEnabled) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        })
        .catch(err => console.error('Error accessing media devices:', err));

      return () => {
        if (localVideoRef.current?.srcObject) {
          const tracks = (localVideoRef.current.srcObject as MediaStream).getTracks();
          tracks.forEach(track => track.stop());
          localVideoRef.current.srcObject = null;
        }
      };
    }
  }, [videoEnabled]);

  const toggleVideo = () => {
    setVideoEnabled(!videoEnabled);
  };

  const togglePanel = (panel: Panel) => {
    setRightPanel(prev => prev === panel ? 'none' : panel);
  };

  const addNewFile = () => {
    const fileName = prompt('Enter file name (with extension):');
    if (!fileName) return;

    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    let language = 'plaintext';
    
    switch (extension) {
      case 'html': language = 'html'; break;
      case 'css': language = 'css'; break;
      case 'js': language = 'javascript'; break;
      case 'ts': language = 'typescript'; break;
      case 'json': language = 'json'; break;
      case 'md': language = 'markdown'; break;
      // Add more extensions as needed
    }

    const newFile: File = {
      id: Date.now().toString(),
      name: fileName,
      language,
      content: ''
    };

    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
  };

  const saveFile = () => {
    const file = files.find(f => f.id === activeFileId);
    if (!file) return;

    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 p-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Code2 className="w-6 h-6" />
          <h1 className="text-xl font-bold">Collaborative Code Editor</h1>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={addNewFile}
            className="flex items-center space-x-2 px-4 py-2 rounded bg-green-600 hover:bg-green-700"
          >
            <Plus className="w-4 h-4" />
            <span>New File</span>
          </button>
          <button
            onClick={saveFile}
            className="flex items-center space-x-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4" />
            <span>Save File</span>
          </button>
          <button
            onClick={() => togglePanel('preview')}
            className={`flex items-center space-x-2 px-4 py-2 rounded ${
              rightPanel === 'preview' ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Preview</span>
          </button>
          <button
            onClick={() => togglePanel('terminal')}
            className={`flex items-center space-x-2 px-4 py-2 rounded ${
              rightPanel === 'terminal' ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            <TerminalIcon className="w-4 h-4" />
            <span>Terminal</span>
          </button>
          <button
            onClick={toggleVideo}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
          >
            {videoEnabled ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            <span>{videoEnabled ? 'Disable' : 'Enable'} Video</span>
          </button>
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4" />
            <span>{peers.size} connected</span>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-4rem)]">
        {/* File Explorer */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase text-gray-400">Files</h2>
            <FolderOpen className="w-4 h-4 text-gray-400" />
          </div>
          <div className="space-y-2">
            {files.map(file => (
              <button
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded text-left ${
                  file.id === activeFileId ? 'bg-blue-600' : 'hover:bg-gray-700'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className={`flex-1 ${rightPanel !== 'none' ? 'w-1/2' : 'w-full'}`}>
          <Editor
            height="100%"
            defaultLanguage={activeFile.language}
            language={activeFile.language}
            value={activeFile.content}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>

        {/* Right Panel */}
        {rightPanel !== 'none' && (
          <div className="w-1/2 bg-gray-800 border-l border-gray-700">
            {rightPanel === 'preview' && (
              <iframe
                ref={previewRef}
                className="w-full h-full bg-white"
                sandbox="allow-scripts"
                title="Preview"
              />
            )}
            {rightPanel === 'terminal' && (
              <div ref={terminalRef} className="w-full h-full" />
            )}
          </div>
        )}

        {/* Video Chat */}
        {videoEnabled && (
          <div className="w-80 bg-gray-800 p-4 border-l border-gray-700">
            <h2 className="text-lg font-semibold mb-4">Video Chat</h2>
            <div className="space-y-4">
              <div className="relative">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full rounded-lg bg-gray-700"
                />
                <span className="absolute bottom-2 left-2 bg-gray-900 px-2 py-1 rounded text-sm">
                  You
                </span>
              </div>
              <div ref={remoteVideosRef} className="space-y-4" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;