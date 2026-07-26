//go:build !windows

package gamedir

import "os"

// defaultSyncDir 在 POSIX 系统上对目录做 fsync，确保 rename 后的目录项落盘。
func defaultSyncDir(root string) error {
	dir, err := os.Open(root)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
