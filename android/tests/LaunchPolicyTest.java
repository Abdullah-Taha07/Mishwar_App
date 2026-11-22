import com.abdallataha.mishwar.LaunchPolicy;
public class LaunchPolicyTest {
 static final String URL="https://mishwar-rider.vercel.app/";
 static class Fake implements LaunchPolicy.Opener {int custom,browser;boolean failCustom,failBrowser;public void customTab(String s){custom++;if(failCustom)throw new IllegalStateException();}public void browser(String s){browser++;if(failBrowser)throw new IllegalStateException();}}
 static void check(boolean v){if(!v)throw new AssertionError();}
 public static void main(String[] args){Fake a=new Fake();check(LaunchPolicy.open(URL,a));check(a.custom==1&&a.browser==0);Fake b=new Fake();b.failCustom=true;check(LaunchPolicy.open(URL,b));check(b.browser==1);Fake c=new Fake();c.failCustom=true;c.failBrowser=true;check(!LaunchPolicy.open(URL,c));check(!LaunchPolicy.open("javascript:alert(1)",new Fake()));check(!LaunchPolicy.open("https://untrusted.example/",new Fake()));check(!LaunchPolicy.open("https://person@mishwar-rider.vercel.app/",new Fake()));System.out.println("6 native launch-policy checks passed");}
}
