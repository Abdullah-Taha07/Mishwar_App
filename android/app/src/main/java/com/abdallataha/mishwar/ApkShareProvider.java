package com.abdallataha.mishwar;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Read-only, non-exported content provider for this application's own installed APK. */
public class ApkShareProvider extends ContentProvider {
  private File installedApk(Uri uri) throws FileNotFoundException {
    if (!"/application.apk".equals(uri.getPath())) throw new FileNotFoundException("Invalid path");
    return new File(getContext().getApplicationInfo().sourceDir);
  }
  @Override public boolean onCreate() { return true; }
  @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
  @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
    return ParcelFileDescriptor.open(installedApk(uri), ParcelFileDescriptor.MODE_READ_ONLY);
  }
  @Override public Cursor query(Uri uri, String[] projection, String selection,
      String[] selectionArgs, String sortOrder) {
    try {
      File file = installedApk(uri);
      String[] columns = projection == null
        ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
      MatrixCursor output = new MatrixCursor(columns);
      Object[] values = new Object[columns.length];
      String role = getContext().getPackageName().replace("com.abdallataha.mishwar.", "");
      for (int i = 0; i < columns.length; i++) {
        if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "mishwar-" + role + ".apk";
        else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
      }
      output.addRow(values);
      return output;
    } catch (FileNotFoundException e) { return null; }
  }
  @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
  @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
  @Override public int update(Uri uri, ContentValues values, String where, String[] args) {
    throw new UnsupportedOperationException();
  }
}
