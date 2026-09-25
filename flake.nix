{
  description = "WACK - Sonoma Lockscreen GNOME Shell extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    flake-utils.url = "github:numtide/flake-utils";

    co = {
      url = "github:codotcodes/co/v0.5.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    co,
  } @ inputs:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        sonomaMeta = builtins.fromJSON (builtins.readFile ./metadata.json);
        extensionUuid = sonomaMeta.uuid;
        wack-sonoma-lockscreen = pkgs.stdenvNoCC.mkDerivation {
          inherit extensionUuid;
          pname = "wack-sonoma-lockscreen";
          version = sonomaMeta.version-name or "unstable";

          src = ./.;

          nativeBuildInputs = [
            pkgs.glib
            pkgs.python3
            pkgs.gettext
          ];

          buildPhase = ''
            runHook preBuild
            python3 po/generate.py
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/gnome-shell/extensions/${extensionUuid}
            
            # Copy extension files excluding build/dev/pro files matching Makefile EXCLUDES
            cp -r metadata.json stylesheet.css *.js src locale schemas $out/share/gnome-shell/extensions/${extensionUuid}/ 2>/dev/null || true
            rm -rf $out/share/gnome-shell/extensions/${extensionUuid}/src/pro*
            rm -f $out/share/gnome-shell/extensions/${extensionUuid}/pro.js
            rm -f $out/share/gnome-shell/extensions/${extensionUuid}/crossSessionManager.js

            if [ -d "$out/share/gnome-shell/extensions/${extensionUuid}/schemas" ]; then
              glib-compile-schemas $out/share/gnome-shell/extensions/${extensionUuid}/schemas
            fi
            runHook postInstall
          '';

          passthru = {
            inherit extensionUuid;
            extensionPath = "share/gnome-shell/extensions/${extensionUuid}";
          };
        };
      in {
        packages = {
          inherit wack-sonoma-lockscreen;
          default = wack-sonoma-lockscreen;
        };

        devShells.default = pkgs.mkShell {
          packages = [
            inputs.co.packages.${system}.default
            pkgs.alejandra
            pkgs.inter
          ];
        };

        formatter = pkgs.alejandra;
      }
    )
    // {
      overlays.default = final: prev: {
        wack-sonoma-lockscreen = self.packages.${prev.stdenv.system}.default;
      };
    };
}
