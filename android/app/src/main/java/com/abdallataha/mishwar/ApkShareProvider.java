package com.abdallataha.mishwar;
import android.content.ContentProvider;import android.content.ContentValues;import android.database.Cursor;import android.database.MatrixCursor;import android.net.Uri;import android.os.ParcelFileDescriptor;import android.provider.OpenableColumns;import java.io.File;import java.io.FileNotFoundException;
/** Grants access only to this application's installed APK, never arbitrary app files. */
public class ApkShareProvider extends ContentProvider {
 private File apk(Uri uri)throws FileNotFoundException{if(!"/application.apk".equals(uri.getPath()))throw new FileNotFoundException("Unsupported path");return new File(getContext().getApplicationInfo().sourceDir);}
 public boolean onCreate(){return true;}public String getType(Uri u){return "application/vnd.android.package-archive";}
 public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(apk(u),ParcelFileDescriptor.MODE_READ_ONLY);}
 public Cursor query(Uri u,String[] projection,String selection,String[] args,String sort){try{File f=apk(u);String[] columns=projection!=null?projection:new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};MatrixCursor c=new MatrixCursor(columns);Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?"mishwar-0.2.0.apk":OpenableColumns.SIZE.equals(columns[i])?f.length():null;c.addRow(values);return c;}catch(FileNotFoundException e){return null;}}
 public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
}
