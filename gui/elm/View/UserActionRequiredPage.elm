module View.UserActionRequiredPage exposing (view)

import Html exposing (..)
import Html.Attributes exposing (..)
import Model exposing (UserActionRequiredError)
import Locale exposing (Helpers)


include_GDPR_link : String -> String -> List (Html msg)
include_GDPR_link base_text url =
    List.intersperse (a [ href url ] [ text "GDPR" ])
        (List.map text (String.split "GDPR" base_text))


view : Helpers -> UserActionRequiredError -> Html msg
view helpers { code, title, detail, links } =
    div [ class "two-panes two-panes__content user-action-required" ]
        (if code == "tos-updated" then
            [ img [ class "error_img", src "images/tos_updated.svg" ] []
            , h2 [] [ text (helpers.t "CGU Updated") ]
            , p [] (include_GDPR_link (helpers.t "CGU Updated Detail") (helpers.t "CGU GDPR Link"))
            , p []
                [ strong [] [ text (helpers.t "CGU Updated Required strong") ]
                , text " "
                , text (helpers.t "CGU Updated Required rest")
                ]
            , a [ class "btn", href links.self ] [ text (helpers.t "CGU Updated See") ]
            ]
         else
            [ h2 [] [ text title ]
            , p [] [ text detail ]
            , a [ class "btn", href links.self ] [ text (helpers.t "Error Ok") ]
            ]
        )