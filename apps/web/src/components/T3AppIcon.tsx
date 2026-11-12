// The production icon, as GitHub shows the T3 Code app, whatever this build's channel.
import appIconUrl from "../assets/t3-github-app.png";

export function T3AppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
