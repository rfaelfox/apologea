// APOLOGEA Kollektionsverwaltung – Windows-Dialoge (Ordner wählen, Speichern unter, Zwischenablage)
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Apologea
{
    /// <summary>Unsichtbares Fenster im UI-Thread, über das der Server Windows-Dialoge anzeigt.</summary>
    public class HostForm : Form
    {
        public HostForm()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            Size = new Size(1, 1);
            Opacity = 0;
        }

        protected override void SetVisibleCore(bool value)
        {
            if (!IsHandleCreated) CreateHandle();
            base.SetVisibleCore(false);
        }

        public T Run<T>(Func<T> f)
        {
            if (!InvokeRequired) return f();
            return (T)Invoke(f);
        }

        Form MakeOwner()
        {
            var owner = new Form();
            owner.ShowInTaskbar = false;
            owner.TopMost = true;
            owner.FormBorderStyle = FormBorderStyle.None;
            owner.StartPosition = FormStartPosition.CenterScreen;
            owner.Size = new Size(1, 1);
            owner.Opacity = 0;
            owner.Show();
            NativeMethods.ForceForeground(owner.Handle);
            owner.Activate();
            return owner;
        }

        public string PickFolder(string title, string initial)
        {
            return Run(delegate ()
            {
                using (var owner = MakeOwner())
                {
                    string r = NativeMethods.PickFolderModern(owner.Handle, title, initial);
                    if (r == "\u0000FALLBACK")
                    {
                        using (var fb = new FolderBrowserDialog())
                        {
                            fb.Description = title;
                            fb.ShowNewFolderButton = true;
                            if (!string.IsNullOrEmpty(initial) && Directory.Exists(initial)) fb.SelectedPath = initial;
                            r = fb.ShowDialog(owner) == DialogResult.OK ? fb.SelectedPath : null;
                        }
                    }
                    return r;
                }
            });
        }

        public string SaveFile(string title, string initialDir, string fileName, string filter)
        {
            return Run(delegate ()
            {
                using (var owner = MakeOwner())
                using (var d = new SaveFileDialog())
                {
                    d.Title = title;
                    d.FileName = fileName;
                    d.Filter = filter;
                    d.OverwritePrompt = true;
                    d.AddExtension = true;
                    if (!string.IsNullOrEmpty(initialDir) && Directory.Exists(initialDir)) d.InitialDirectory = initialDir;
                    return d.ShowDialog(owner) == DialogResult.OK ? d.FileName : null;
                }
            });
        }

        public string OpenFile(string title, string filter)
        {
            return Run(delegate ()
            {
                using (var owner = MakeOwner())
                using (var d = new OpenFileDialog())
                {
                    d.Title = title;
                    d.Filter = filter;
                    return d.ShowDialog(owner) == DialogResult.OK ? d.FileName : null;
                }
            });
        }

        public bool SetClipboard(string text)
        {
            return Run(delegate ()
            {
                for (int i = 0; i < 5; i++)
                {
                    try { Clipboard.SetText(text); return true; }
                    catch { System.Threading.Thread.Sleep(80); }
                }
                return false;
            });
        }
    }

    static class NativeMethods
    {
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        public static void ForceForeground(IntPtr h)
        {
            try
            {
                IntPtr fg = GetForegroundWindow();
                uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
                uint me = GetCurrentThreadId();
                if (fgThread != me) AttachThreadInput(me, fgThread, true);
                SetForegroundWindow(h);
                if (fgThread != me) AttachThreadInput(me, fgThread, false);
            }
            catch { }
        }

        // ---- moderner Ordnerdialog (IFileOpenDialog mit FOS_PICKFOLDERS) ----
        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
            void SetFileTypeIndex(uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise(IntPtr pfde, out uint pdwCookie);
            void Unadvise(uint dwCookie);
            void SetOptions(uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder(IShellItem psi);
            void SetFolder(IShellItem psi);
            void GetFolder(out IShellItem ppsi);
            void GetCurrentSelection(out IShellItem ppsi);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult(out IShellItem ppsi);
            void AddPlace(IShellItem psi, int fdap);
            void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
            void Close(int hr);
            void SetClientGuid(ref Guid guid);
            void ClearClientData();
            void SetFilter(IntPtr pFilter);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem ppsi);
            void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
            void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
            void Compare(IShellItem psi, uint hint, out int piOrder);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

        public static string PickFolderModern(IntPtr owner, string title, string initial)
        {
            try
            {
                var dlg = (IFileDialog)new FileOpenDialogRCW();
                uint opts;
                dlg.GetOptions(out opts);
                dlg.SetOptions(opts | 0x20 | 0x40 | 0x800); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
                dlg.SetTitle(title);
                dlg.SetOkButtonLabel("Ordner auswählen");
                if (!string.IsNullOrEmpty(initial) && Directory.Exists(initial))
                {
                    try
                    {
                        IShellItem item;
                        SHCreateItemFromParsingName(initial, IntPtr.Zero, typeof(IShellItem).GUID, out item);
                        dlg.SetFolder(item);
                    }
                    catch { }
                }
                int hr = dlg.Show(owner);
                if (hr != 0) return null;
                IShellItem res;
                dlg.GetResult(out res);
                string path;
                res.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }
            catch
            {
                return "\u0000FALLBACK";
            }
        }
    }
}
