#!/usr/bin/env python3
"""Dependency-free debug APK build using the installed Android SDK and JDK."""
from pathlib import Path
import argparse,subprocess,shutil,zipfile,json,hashlib,os
from xml.sax.saxutils import escape
p=argparse.ArgumentParser();p.add_argument('--sdk',required=True);p.add_argument('--key',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];sdk=Path(a.sdk).resolve();out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True);key=Path(a.key).resolve();tools=sdk/'build-tools/36.0.0';jar=sdk/'platforms/android-36/android.jar';work=root/'build-sdk';work.mkdir(exist_ok=True)
def run(cmd):
 if str(cmd[0])=='javac' and not shutil.which('javac'):cmd=['java','--module','jdk.compiler/com.sun.tools.javac.Main',*cmd[1:]]
 result=subprocess.run([str(x) for x in cmd],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if result.returncode:raise RuntimeError(result.stdout.decode(errors='replace'))
if not key.exists():
 key.parent.mkdir(parents=True,exist_ok=True);run(['keytool','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Android Debug,O=Android,C=US']);key.chmod(0o600)
roles={'rider':('مشوار','mishwar-rider.vercel.app'),'captain':('كابتن مشوار','mishwar-captain.vercel.app'),'admin':('مشوار الإدارة','mishwar-admin-gamma.vercel.app')}
for role,(name,host) in roles.items():
 d=work/role
 if d.exists():shutil.rmtree(d)
 (d/'res/values').mkdir(parents=True);(d/'res/drawable').mkdir();(d/'classes').mkdir();(d/'dex').mkdir()
 shutil.copyfile(root/'app/src/main/res/drawable/ic_launcher.png',d/'res/drawable/ic_launcher.png');shutil.copyfile(root/'app/src/main/res/values/colors.xml',d/'res/values/colors.xml')
 (d/'res/values/strings.xml').write_text('<resources><string name="app_name">'+escape(name)+'</string><string name="launch_url">https://'+host+'/</string></resources>')
 manifest=(root/'app/src/main/AndroidManifest.xml').read_text().replace('<manifest ', '<manifest package="com.abdallataha.mishwar.'+role+'" ',1);(d/'AndroidManifest.xml').write_text(manifest.replace('${applicationId}','com.abdallataha.mishwar.'+role))
 run([tools/'aapt2','compile','--dir',d/'res','-o',d/'compiled.zip'])
 run([tools/'aapt2','link','-I',jar,'--manifest',d/'AndroidManifest.xml','--java',d/'gen','--custom-package','com.abdallataha.mishwar','--min-sdk-version','24','--target-sdk-version','36','--version-code','3','--version-name','0.3.0','-o',d/'base.apk',d/'compiled.zip'])
 sources=list((root/'app/src/main/java').rglob('*.java'))+list((d/'gen').rglob('*.java'));run(['javac','-source','8','-target','8','-Xlint:-options','-cp',jar,'-d',d/'classes',*sources]);run([tools/'d8','--release','--min-api','24','--lib',jar,'--output',d/'dex',*list((d/'classes').rglob('*.class'))])
 with zipfile.ZipFile(d/'base.apk','a') as z:z.write(d/'dex/classes.dex','classes.dex')
 run([tools/'zipalign','-f','-p','4',d/'base.apk',d/'aligned.apk']);target=out/('app-'+role+'-debug.apk');run([tools/'apksigner','sign','--ks',key,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',target,d/'aligned.apk']);run([tools/'apksigner','verify','--verbose',target]);run([tools/'zipalign','-c','-p','4',target])
 print(json.dumps({'role':role,'apk':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
# Pure Java failure-handling checks run without an Android device.
testdir=work/'tests';testdir.mkdir(exist_ok=True);run(['javac','-source','8','-target','8','-Xlint:-options','-d',testdir,root/'app/src/main/java/com/abdallataha/mishwar/LaunchPolicy.java',root/'tests/LaunchPolicyTest.java']);print(subprocess.check_output(['java','-cp',str(testdir),'LaunchPolicyTest'],text=True).strip())
