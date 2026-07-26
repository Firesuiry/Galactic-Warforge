//go:build windows

package gamedir

// defaultSyncDir 在 Windows 上是空操作。
//
// Windows 不允许对目录句柄调用 FlushFileBuffers（CreateFile 打开目录需要
// FILE_FLAG_BACKUP_SEMANTICS，且 Go 的 os.File.Sync 在目录上恒返回
// "Access is denied"）。NTFS 的 MoveFileEx 本身即是元数据事务操作，
// rename 完成后目录项已经在日志里，不需要额外的目录级 flush。
func defaultSyncDir(root string) error {
	_ = root
	return nil
}
