package com.abdallataha.mishwar;
import java.net.URI;
public final class LaunchPolicy {
 public interface Opener {void customTab(String url);void browser(String url);}
 public static boolean open(String url,Opener opener){
  try {URI u=new URI(url);String h=u.getHost();if(!"https".equals(u.getScheme())||u.getUserInfo()!=null||!("rider-turquoise-abdalla.dazzlinglens.chatgpt.site".equals(h)||"mishwar-captain-abdalla.dazzlinglens.chatgpt.site".equals(h)||"mishwar-administration-abdalla.dazzlinglens.chatgpt.site".equals(h)))return false;}catch(Exception e){return false;}
  try{opener.customTab(url);return true;}catch(RuntimeException first){try{opener.browser(url);return true;}catch(RuntimeException second){return false;}}
 }
 private LaunchPolicy(){}
}
