package com.abdallataha.mishwar;
import java.net.URI;
public final class LaunchPolicy {
 public interface Opener {void customTab(String url);void browser(String url);}
 public static boolean open(String url,Opener opener){
  try {URI u=new URI(url);String h=u.getHost();if(!"https".equalsIgnoreCase(u.getScheme())||u.getUserInfo()!=null||!("mishwar-rider.vercel.app".equals(h)||"mishwar-captain.vercel.app".equals(h)||"mishwar-admin-gamma.vercel.app".equals(h)))return false;}catch(Exception e){return false;}
  try{opener.customTab(url);return true;}catch(RuntimeException first){try{opener.browser(url);return true;}catch(RuntimeException second){return false;}}
 }
 private LaunchPolicy(){}
}
