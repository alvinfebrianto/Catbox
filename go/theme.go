package main

import (
	"syscall"
	"unsafe"

	"github.com/lxn/walk"
	"github.com/lxn/win"
)

var (
	uxtheme         = syscall.NewLazyDLL("uxtheme.dll")
	setWindowThemeW = uxtheme.NewProc("SetWindowTheme")
	gdi32           = syscall.NewLazyDLL("gdi32.dll")
	createSolidBrush = gdi32.NewProc("CreateSolidBrush")
)

type DarkTheme struct {
	WindowBG    walk.Color
	ControlBG   walk.Color
	TextFG      walk.Color
	SelectionBG walk.Color
	SelectionFG walk.Color

	windowBrush  win.HBRUSH
	controlBrush win.HBRUSH
}

var darkTheme = &DarkTheme{
	WindowBG:    walk.RGB(32, 32, 32),
	ControlBG:   walk.RGB(45, 45, 45),
	TextFG:      walk.RGB(230, 230, 230),
	SelectionBG: walk.RGB(0, 120, 215),
	SelectionFG: walk.RGB(255, 255, 255),
}

func (t *DarkTheme) Init() {
	r, _, _ := createSolidBrush.Call(uintptr(t.WindowBG))
	t.windowBrush = win.HBRUSH(r)
	r, _, _ = createSolidBrush.Call(uintptr(t.ControlBG))
	t.controlBrush = win.HBRUSH(r)
}

func (t *DarkTheme) Cleanup() {
	if t.windowBrush != 0 {
		win.DeleteObject(win.HGDIOBJ(t.windowBrush))
	}
	if t.controlBrush != 0 {
		win.DeleteObject(win.HGDIOBJ(t.controlBrush))
	}
}

func setWindowTheme(hwnd win.HWND, theme string) {
	if setWindowThemeW.Find() != nil {
		return
	}
	themePtr, _ := syscall.UTF16PtrFromString(theme)
	setWindowThemeW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(themePtr)), 0)
}

func setWindowThemeDisable(hwnd win.HWND) {
	if setWindowThemeW.Find() != nil {
		return
	}
	spacePtr, _ := syscall.UTF16PtrFromString(" ")
	setWindowThemeW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(spacePtr)), uintptr(unsafe.Pointer(spacePtr)))
}

func ApplyDarkTheme(a *App) {
	darkTheme.Init()

	windowBrush, _ := walk.NewSolidColorBrush(darkTheme.WindowBG)
	a.mainWindow.SetBackground(windowBrush)

	applyDarkToComposite(a.urlComposite)
	applyDarkToComposite(a.catboxOptsComposite)
	applyDarkToComposite(a.sxcuOptsComposite)
	applyDarkToComposite(a.imgchestOptsComposite)

	applyDarkToLineEdit(a.urlEdit)
	applyDarkToLineEdit(a.titleEdit)
	applyDarkToLineEdit(a.descEdit)
	applyDarkToLineEdit(a.postIDEdit)

	applyDarkToTextEdit(a.outputEdit)
	applyDarkToListBox(a.fileListBox)
	applyDarkToComboBox(a.providerCombo)
	applyDarkToCheckBox(a.albumCheck)
	applyDarkToCheckBox(a.collectionCheck)
	applyDarkToCheckBox(a.anonymousCheck)

	applyDarkToButton(a.uploadButton)

	applyDarkToLabels(a.mainWindow)
	subclassComposites(a)
	installDarkThemeWndProc(a.mainWindow)
}

func applyDarkToComposite(c *walk.Composite) {
	if c == nil {
		return
	}
	brush, _ := walk.NewSolidColorBrush(darkTheme.WindowBG)
	c.SetBackground(brush)
}

func applyDarkToLineEdit(e *walk.LineEdit) {
	if e == nil {
		return
	}
	e.SetTextColor(darkTheme.TextFG)
	brush, _ := walk.NewSolidColorBrush(darkTheme.ControlBG)
	e.SetBackground(brush)
	setWindowTheme(e.Handle(), "DarkMode_CFD")
}

func applyDarkToTextEdit(e *walk.TextEdit) {
	if e == nil {
		return
	}
	e.SetTextColor(darkTheme.TextFG)
	brush, _ := walk.NewSolidColorBrush(darkTheme.ControlBG)
	e.SetBackground(brush)
	setWindowTheme(e.Handle(), "DarkMode_Explorer")
}

func applyDarkToListBox(lb *walk.ListBox) {
	if lb == nil {
		return
	}
	setWindowTheme(lb.Handle(), "DarkMode_Explorer")
}

func applyDarkToComboBox(cb *walk.ComboBox) {
	if cb == nil {
		return
	}
	setWindowTheme(cb.Handle(), "DarkMode_CFD")
}

func applyDarkToCheckBox(cb *walk.CheckBox) {
	if cb == nil {
		return
	}
	setWindowThemeDisable(cb.Handle())
	if parent := cb.Parent(); parent != nil {
		installDarkThemeWndProcFor(parent.Handle())
	}
	win.InvalidateRect(cb.Handle(), nil, true)
}

func applyDarkToButton(b *walk.PushButton) {
	if b == nil {
		return
	}
	setWindowTheme(b.Handle(), "DarkMode_Explorer")
}

func applyDarkToLabels(container walk.Container) {
	children := container.Children()
	for i := 0; i < children.Len(); i++ {
		child := children.At(i)
		if label, ok := child.(*walk.Label); ok {
			setWindowTheme(label.Handle(), "")
			label.SetTextColor(darkTheme.TextFG)
			if parent := label.Parent(); parent != nil {
				installDarkThemeWndProcFor(parent.Handle())
			}
		}
		if c, ok := child.(walk.Container); ok {
			applyDarkToLabels(c)
		}
	}
}

func subclassComposites(a *App) {
	if a.urlComposite != nil {
		installDarkThemeWndProcFor(a.urlComposite.Handle())
	}
	if a.catboxOptsComposite != nil {
		installDarkThemeWndProcFor(a.catboxOptsComposite.Handle())
	}
	if a.sxcuOptsComposite != nil {
		installDarkThemeWndProcFor(a.sxcuOptsComposite.Handle())
	}
	if a.imgchestOptsComposite != nil {
		installDarkThemeWndProcFor(a.imgchestOptsComposite.Handle())
	}
}

const (
	WM_CTLCOLOREDIT    = 0x0133
	WM_CTLCOLORSTATIC  = 0x0138
	WM_CTLCOLORLISTBOX = 0x0134
	WM_CTLCOLORBTN     = 0x0135
)

var origWndProcs = make(map[win.HWND]uintptr)

func installDarkThemeWndProc(mw *walk.MainWindow) {
	installDarkThemeWndProcFor(mw.Handle())
}

func installDarkThemeWndProcFor(hwnd win.HWND) {
	if _, exists := origWndProcs[hwnd]; exists {
		return
	}
	origWndProcs[hwnd] = win.SetWindowLongPtr(hwnd, win.GWLP_WNDPROC, syscall.NewCallback(darkThemeWndProc))
}

func darkThemeWndProc(hwnd win.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_CTLCOLOREDIT, WM_CTLCOLORLISTBOX:
		hdc := win.HDC(wParam)
		win.SetTextColor(hdc, win.COLORREF(darkTheme.TextFG))
		win.SetBkColor(hdc, win.COLORREF(darkTheme.ControlBG))
		return uintptr(darkTheme.controlBrush)
	case WM_CTLCOLORSTATIC:
		hdc := win.HDC(wParam)
		win.SetTextColor(hdc, win.COLORREF(darkTheme.TextFG))
		win.SetBkMode(hdc, win.TRANSPARENT)
		return uintptr(darkTheme.windowBrush)
	case WM_CTLCOLORBTN:
		hdc := win.HDC(wParam)
		win.SetTextColor(hdc, win.COLORREF(darkTheme.TextFG))
		win.SetBkColor(hdc, win.COLORREF(darkTheme.WindowBG))
		win.SetBkMode(hdc, win.TRANSPARENT)
		return uintptr(darkTheme.windowBrush)
	}
	origProc := origWndProcs[hwnd]
	return win.CallWindowProc(origProc, hwnd, msg, wParam, lParam)
}
